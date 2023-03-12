# sample-app-filtered-subaccount-cost
Sample (Client-Side) SA Cost application for Hybrid Accounts



## Mtls Credentials

To run this project, you will need to add the following Mtls Credentials to paste into the demo.js file

`udmMtlsCreds` `cisMtlsCreds`

Create in the cockpit, service keys with the following JSONS: 
UDM (reporting-ga-admin): 
```javascript
{
  "xsuaa": {
    "credential-type": "x509",
    "x509": {
      "key-length": 2048, 
	  "validity": 7,
      "validity-type": "DAYS"  
	}
  }
}
```
Cis(central):
```javascript

{
	"credential-type": "x509",
	"x509": {
	    "key-length": 2048, 
	    "validity": 7,
	    "validity-type": "DAYS"
	}
 }
 ```

## API Reference

#### Get Calculated SubAccount Cost Usage Data

```HTTP
http://localhost:3000/getCalculatedConsumption?startDate={startDate}&toDate={toDate}
```

| Parameter | Type     | Description                |
| :-------- | :------- | :------------------------- |
| `fromDate` | `string` | **Required**. Billing from date |
| `toDate` | `string` | **Required**. Billing to date |


For example:
```HTTP
http://localhost:3000/getCalculatedConsumption?startDate=202101&toDate=202205
```
## Run The Sample App

Clone the project

```bash
git clone https://github.wdf.sap.corp/uas/sample-app-filtered-subaccount-cost
```

Go to the project directory

```bash
cd sample-app-filtered-subaccount-cost
```


Start the server

```bash
  node demo.js
```

