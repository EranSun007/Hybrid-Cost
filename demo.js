const express = require('express')
const request = require("request");
const {URL} = require("url");
const app = express()
const port = 3000
const udmMtlsCreds = "***";
const cisMtlsCreds = "***";
const AUTH_ADDRESS = "/oauth/token";
const GLOBAL_ACCOUNT_LABEL_ADDRESS = '/accounts/v1/subaccounts';


//  For filtered MONTHLY_SUBACCOUNT_COST
app.get('/getCalculatedConsumption', function (req, res) {
    const FROM_DATE = req.query.startDate;
    const TO_DATE = req.query.toDate;
    const MONTHLY_SUBACCOUNT_COST = `/reports/v1/monthlySubaccountsCost?fromDate=${FROM_DATE}&toDate=${TO_DATE}`;

    const uasAuthRequest = getAuthRequest(udmMtlsCreds);
    //Authenticate request for UDM services
    request(uasAuthRequest, (uasAuthErr, uasAuthRes, uasAuthData) => {
        if (uasAuthRes.statusCode !== 200)
            throw uasAuthErr;

        const token = JSON.parse(uasAuthData).access_token;
        const getRequest = createGetRequest(udmMtlsCreds.target_url + MONTHLY_SUBACCOUNT_COST, token);
        //Get subaccountCostUsage Request
        request(getRequest, (usageErr, usageResponse, usageData) => {
            console.log("Status code is ", usageResponse.statusCode);
            if (usageResponse.statusCode !== 200)
                throw usageErr;

            const authCisRequest = getAuthRequest(cisMtlsCreds.uaa);
            //Authenticate request for CIS services
            request(authCisRequest, (cisAuthErr, cisAuthRes, cisAuthData) => {
                console.log("AuthCisRequest Status is: ", cisAuthRes.statusCode);
                if (cisAuthRes.statusCode !== 200)
                    throw cisAuthErr;
                const cisToken = JSON.parse(cisAuthData).access_token;
                const getCisRequest = createGetRequest(cisMtlsCreds.endpoints.accounts_service_url + GLOBAL_ACCOUNT_LABEL_ADDRESS, cisToken);
                //Get subaccountsLabels Request
                request(getCisRequest, (cisLabelsErr, cisLabelsRes, cisLabelsData) => {
                    if (cisLabelsRes.statusCode !== 200)
                        throw cisLabelsErr;
                    const parsedCostUsage = JSON.parse(usageData);
                    const subaccountToExclude = getSubaccountToExclude(cisLabelsData);
                    const gaCostAndUsage = createGroupedGlobalAccountCost(parsedCostUsage, subaccountToExclude);
                    const excludedSubaccountCost = filterAndEditGlobalAccountCost(gaCostAndUsage, subaccountToExclude, parsedCostUsage);
                    res.send(excludedSubaccountCost);
                });
            });
        });
    });
});

app.listen(port, () => {
    console.log(`Sample app listening on port ${port}`)
})

//Create URL REQUEST
function assembleRequestUrl(context) {
    // Build API endpoint URL.
    const url = new URL(context.url);
    // Set query parameters.
    for (let param in context.params) {
        url.searchParams.set(param, context.params[param]);
    }
    if (context.scope) {
        url.searchParams.set("scope", context.scope);
    }
    return url.toString();
}

//Create Auth Request
function getAuthRequest(cred) {
    let urlContext = {
        url: cred.certurl + AUTH_ADDRESS,
        params: {
            grant_type: "client_credentials",
            response_type: "token",
            client_id: cred.clientid,
        }
    };
    return {
        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        url: assembleRequestUrl(urlContext),
        cert: cred.certificate,
        key: cred.key,
    };
}

//Create Get Request
function createGetRequest(url, token) {
    return {
        url: url,
        headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json",
        }
    };
}

/*
Returning set of subaccount_ids of all subaccounts that has 'EXCLUDE' label
 */
function getSubaccountToExclude(cisLabelsData) {
    const subaccountToExclude = new Set();
    (JSON.parse(cisLabelsData).value).map(subAccountData => {
        if (subAccountData.labels !== undefined && subAccountData.labels.EXCLUDE !== undefined)
            subaccountToExclude.add(subAccountData.guid);
    });
    return subaccountToExclude;
}

//Create Primary key by globalAccountId,serviceId,plan,metricName,reportYearMonth
function createPrimaryKey(SubAccountUsage) {
    return SubAccountUsage.globalAccountId + "-" +
        SubAccountUsage.serviceId + "-" +
        SubAccountUsage.plan + "-" +
        SubAccountUsage.metricName + "-" +
        SubAccountUsage.reportYearMonth
}

//Create for map of primaryKey and total cost and total usage
function createGlobalAccountCostAndUsage(subAccountUsage, labelsSet) {
    const primaryKey = createPrimaryKey(subAccountUsage)
    const alteredUsage = labelsSet.has((subAccountUsage.subaccountId)) ? 0 : subAccountUsage.usage;
    return {
        name: primaryKey,
        totals: {
            cost: subAccountUsage.cost,
            usage: alteredUsage
        }
    };
}

// Group by key the total usage and total cost
function groupByKey(globalAccountUsageToGroupBy, key) {
    return globalAccountUsageToGroupBy.reduce((result, currentValue) => {
        const primaryKey = currentValue[key];
        const item = result.get(primaryKey) || Object.assign({}, currentValue.totals, {
            cost: 0,
            usage: 0
        });
        item.cost += currentValue.totals.cost;
        item.usage += currentValue.totals.usage;
        return result.set(primaryKey, item);
    }, new Map);
}

/*
Parse the usage from monthlySubaccountsCost API
Return map that the key is {globalAccountId,serviceId,plan,metricName,reportYearMonth}
                the value is the total cost and total usage without summing the usage of subaccount that are excluded
 */
function createGroupedGlobalAccountCost(parsedCostUsage, subaccountToExclude) {
    const subaccountUsageData = parsedCostUsage.content;
    const globalAccountUsageToGroupBy = subaccountUsageData.map(currSubAccount => createGlobalAccountCostAndUsage(currSubAccount, subaccountToExclude));
    return groupByKey(globalAccountUsageToGroupBy, 'name');
}

function updateSubaccountCostUsage(subAccountCost,gaCostAndUsage){
    const primaryKey = createPrimaryKey(subAccountCost);
    const totalCostAndUsage = gaCostAndUsage.get(primaryKey);
    const relativeUsage = subAccountCost.usage / totalCostAndUsage.usage;
    subAccountCost.cost = totalCostAndUsage.cost * relativeUsage;
    return subAccountCost;
}

/*
Filter excluded subaccounts usage from monthlySubaccountsCost
Edit cost of the remaining subaccounts
 */

function filterAndEditGlobalAccountCost(gaCostAndUsage, subaccountToExclude, parsedCostUsage) {
    const subaccountUsageData = parsedCostUsage.content;
    const calculatedCost = subaccountUsageData
        .filter(currentSubAccountUsage => !subaccountToExclude.has(currentSubAccountUsage.subaccountId))
        .map(currentSubAccountUsage => updateSubaccountCostUsage(currentSubAccountUsage,gaCostAndUsage));
    parsedCostUsage.content = Array.from(calculatedCost);
    return parsedCostUsage;
}