// Check valid regions https://api.spot-hinta.fi/swagger/ui
let PriceAllowed = "9"; // Set the maximum electricity price at which you want the device to be on (cents)
let minTemp = 22.1; // Minimum temperature
let maxTemp = 22.5; // Maximum temperature

//last known h,    hourly price fetched,   temperature rising,     relay closed,      price below limit
let cHour = ""   ;   let fetched = false; let rising = false   ; let rclosed = true; let priceOk = false; 
let urlToCall = "https://api.spot-hinta.fi/JustNowRank/0/" + PriceAllowed;

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
 * @returns succesful fetch -> current temperature as a number, 
 * else returns "error"
 */
function getTemp() {
  let temp;
  try {
      temp = Shelly.getComponentStatus('Temperature', 100).tC;  //Temp ID, mostly 100 to 102
      print(temp);
  } catch(error) { print(error); temp = "error"; }
  return temp;
}

/**
 * Actual relay function and logic related to it.
 * @param {string} status "stop" -> relay switches off, anything else -> relay switches on
 */
function manageWarming(status) {
  if (status === "stop") {
    Shelly.call("Switch.Set", "{ id:0, on:false}", null, null); 
    print("Relay OFF"); 
    rising = false; 
    rclosed = true;
  }
  else {
    Shelly.call("Switch.Set", "{ id:0, on:true}", null, null); 
    print("Relay ON"); 
    rising = true;
    rclosed = false;
  }
}

/**
 * Responsible for handling proper calls for relay work.
 */
function handleWarming() {
  // cant fetch price or its too high and relay is on results in it closing
  if (!priceOk && !rclosed) { manageWarming("stop"); }
  //price too high or invalid fetch but relay is already closed
  else if (!priceOk) { return; } 
  
  let temp = getTemp();
  
  // invalid fetch for temperature
  if (typeof temp !== "number") { manageWarming("stop"); } 
  
  // temperature has risen below the set limit  
  if (temp > maxTemp && rising) { manageWarming("stop"); }

  //temperate has gone below the set limit
  else if (minTemp > temp && !rising) { rising = true; manageWarming("start"); }
}

/**
 * "Main function"
 */
Timer.set(30000, true, function () {
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

        Shelly.call("HTTP.GET", { url: urlToCall, timeout: 15, ssl_ca: "*" }, handleResponse);

        if (res["switch:0"] && typeof res["switch:0"].output === "boolean") {
          rclosed = !res["switch:0"].output;
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
      
      handleWarming();
    });
  } catch (outerErr) {
    print("Error (outer error):", outerErr);
  }
});