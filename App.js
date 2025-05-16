// Check valid regions https://api.spot-hinta.fi/swagger/ui
let PriceAllowed = "9"; // Set the maximum electricity price at which you want the device to be on (cents)
let minTemp = 22.1; // Minimum temperature
let maxTemp = 22.5; // Maximum temperature

//last known h,    hourly price fetched,   temperature rising,     relay on,      price below limit
let cHour = ""   ;   let fetched = false; let rising = false   ; let relon= false; let priceOk = false; let curTemp = 0;
let urlToCall = "https://api.spot-hinta.fi/JustNowRank/0/" + PriceAllowed;

/**
 * Creates and returns an object which has all the attributes as its properties.
 */
function scriptStatus() {
  return {
    allowed_price: PriceAllowed,
    minimum_temperature: minTemp,
    maximum_temperature: maxTemp,
    current_temperature: curTemp,
    current_fetched_hour: cHour,
    price_fetched: fetched,
    temperature_rising: rising,
    relay_on: relon,
    price_below_limit: priceOk
  }
};

/**
 * Prints names and values of the attributes.
 */
function printScriptStatus() {
  let status = "Status report:";
  const statusObj = scriptStatus();
  for (let key in statusObj ) {
     status += " " + key + ": " + statusObj [key] + ",";
  }
  status = status.slice(0, -1);
  
  print(status);
}

/**
 * Sends HTTP GET REQUEST to the eletricity price site and calls response handling function.
 */
function checkPrice() {
  Shelly.call("HTTP.GET", { url: urlToCall, timeout: 15, ssl_ca: "*" }, function (res, err) {
    if (err) {
      print("HTTP GET error:", JSON.stringify(err));
      priceOk = false;
      fetched = false;
      return;
    }

    handleResponse(res);
  });
}


/**
 * If-statements and their assignments prevent future needs to fetch price status again
 * @param {JSON} res HTTP GET results of fetch 
 * @returns price ok -> true, price too expensive -> false, invalid response -> doesnt assign
 * global variables fetch resulting in being called again later
 */
function handleResponse(res) {
  priceOk = false; // default

  switch (res.code) {
    case 200: // If status code is 200, the price is OK
      priceOk = true;
      fetched = true;
      break;
    case 400: // If status code is 400, the price is too high
      priceOk = false;
      fetched = true;
      break;
    // If unexpected responses, assume price is not OK
    case 404: // TODO : in case of multiple 404 add cooldown or skip for a while and for safety measures turn off
      print("404: Could not load price information.");
      priceOk = false;
      break;
    case 429: // TODO : in case of multiple spam 429 add cooldown
      print("429: Too many requests from this IP address. Slow down.");
      priceOk = false;
      break;
    case 500:
      print("500: Fatal error. Error report has been sent.");
      priceOk = false;
      break;
    default:
      print("Unhandled response code", res.code);
      priceOk = false; 
  }
}

/**
 * Temperature fetch and its error handling.
 * @returns succesful fetch -> current temperature as a number
 */
function getAndUpdateTemp() {
  let temp;
  try {
      temp = Shelly.getComponentStatus('Temperature', 100).tC;  //Temp ID, mostly 100 to 102
      //print("Temperature from sensor:", temp);
  } catch(error) { print(error); manageWarming("stop"); }
  
  if (typeof temp === "number") { curTemp = temp; }
  else { manageWarming("stop"); }
  
  return temp;
}

/**
 * Actual relay function and logic related to it.
 * @param {string} status "stop" -> relay switches off, anything else -> relay switches on
 */
function manageWarming(status) {
  if (status === "stop") {
    //Shelly.call("Switch.Set", "{ id:0, on:false}", null, null); 
    print("Relay OFF"); 
    rising = false; 
    relon= false;
  }
  else {
    //Shelly.call("Switch.Set", "{ id:0, on:true}", null, null); 
    print("Relay ON"); 
    rising = true;
    relon= true;
  }
}

/**
 * Responsible for handling proper calls for relay work.
 */
function handleWarming() {
  print("handling warming");
  // cant fetch price or its too high and relay is on results in it closing
  if (!priceOk && relon) { manageWarming("stop"); print("1 if");}
  //price too high or invalid fetch
  else if (!priceOk) { return; print("2 if");} 
  
  let temp = getAndUpdateTemp();
  
  // invalid fetch for temperature
  if (typeof temp !== "number") { manageWarming("stop"); print("3 if"); return; } 
  
  // temperature has risen below the set limit  
  if (temp > maxTemp && rising) { manageWarming("stop"); print("4 if"); }
  
  // safety measure
  if (temp > maxTemp + 0.4) { manageWarming("stop"); print("5 if");}

  //temperate has gone below the set limit
  else if (minTemp > temp && !rising) { rising = true; manageWarming("start"); print("6 if");}
}

function updateRelayStateAndTime() {
  try { // Emergency shutdown incase an error happens during status fetch
    Shelly.call("Shelly.GetStatus", "", function (res, err) {
      if (err) {
        print("Error fetching Shelly status: " + JSON.stringify(err));
        manageWarming("stop");
        return;
      }
      
      try {
        let hour = res.sys.time.slice(0, 2); // f.ex. "21:34"
        if (cHour !== hour) { cHour = hour; fetched = false; }
        if (fetched === true) { return; }

        if (res["switch:0"] && typeof res["switch:0"].output === "boolean") {
          relon = res["switch:0"].output;
        } else {
          print("Relay status missing or invalid, assuming OFF.");
          manageWarming("stop");
          return;
        }    
      } catch (innerErr) {
        print("Error processing Shelly status response (inner error):", innerErr);
        manageWarming("stop");
        return;
      }
    });
  } catch (outerErr) {
    print("Error (outer error):", outerErr);
  }
}


function run() {
  // Beginning state inits 
  print("Script started");
  updateRelayStateAndTime();

  // Price verification

  // Temperature verification

  mainloop()
}

/**
 * TODO
 * "Main function"
 * */
function mainloop() {
  Timer.set(10000, true, function () {
    checkPrice();
    print("price checked");

    if (!priceOk) {
      updateRelayStateAndTime();
      print("relon updated");
      handleWarming();
      print("warming handled");
    }

    getAndUpdateTemp();
    printScriptStatus();
    
    handleWarming();
    
  });
}

run();