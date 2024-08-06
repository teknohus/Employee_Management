const { getIconForPath, ICON_SIZE_SMALL } = require("system-icon");
const screenshot = require("screenshot-desktop");
const { screen, powerMonitor, app, shell } = require("electron");
const activeWin = require("active-win");
const dayjs = require("dayjs");
const timezone = require("dayjs/plugin/timezone");
const utc = require("dayjs/plugin/utc");
const path = require("path");
const fs = require("fs");
const Jimp = require("jimp");
const BrowserHistory = require("node-browser-history");
const { is } = require("electron-util");
const { title } = require("process");
const stringSimilarity = require("string-similarity");
const moment = require("moment-timezone");

dayjs.extend(utc);
dayjs.extend(timezone);

async function getIcon(path) {
  return new Promise((resolve, reject) => {
    getIconForPath(path, ICON_SIZE_SMALL, (err, result) => {
      if (err) return reject(err);
      return resolve(result);
    });
  });
}

async function getOperatingSystem(){
  let operatingSystem;

  if (is.windows) {
    operatingSystem = "windows";
  } else if (is.macos) {
    operatingSystem = "mac";
  } else {
    operatingSystem = "linux";
  }

  return operatingSystem;
}

function getScreenshot() {
  return new Promise((resolve, reject) => {
    screenshot.all({ format: "png" }).then(resolve).catch(reject);
  });
}

async function installExtensions() {
  const installer = require("electron-devtools-installer");
  const forceDownload = !!process.env.UPGRADE_EXTENSIONS;
  const extensions = ["REACT_DEVELOPER_TOOLS", "APOLLO_DEVELOPER_TOOLS"];

  return Promise.all(
    extensions.map((name) => installer.default(installer[name], forceDownload))
  ).catch(console.log);
}

async function getWindow(args, settings, store, includeScreenshot) {
  const {
    organisationTimezone,
    screenCapture,
    blurScreenCapture,
    stealthMode,
    idleMinutesThreshold,
    projectManagement
  } = settings;
  const { userId, organisationId, taskId, taskName, projectId, projectName, taskDescription, taskTimeId, taskStartTime, teamId } = args;

  const { height, width } = screen.getPrimaryDisplay().workAreaSize;

  const time = dayjs.tz(new Date(), organisationTimezone);
  const timeString = time.format("HH.mm");
  const activeWindow = await activeWin();

  const disableScreenCapture = store.get("disableScreenCapture");
  const planType = store.get("planType");
  const productivityStatus =  store.get("productivityStatus") || [];
  const appSites =  store.get("appSites") || [];
  const lastActivity = store.get("lastActivity") || [];

  let screenshotData;
  if (screenCapture && includeScreenshot && !disableScreenCapture) {
    try {
      screenshotData = await getScreenshotWindow(settings, includeScreenshot);
    } catch (error) {
      console.log(error);
      screenshotData = null
    }
  }

  async function round(n) {
    // Smaller multiple
    let a = parseInt(n / 10, 10) * 10;

    // Larger multiple
    let b = a + 10;

    // Return of closest of two
    return n - a > b - n ? b : a;
  }

  let idleSeconds = await round(Math.floor(powerMonitor.getSystemIdleTime()));
  const idleSurplusSeconds = store.get("idleSurplusSeconds") || 0;

  const idleSecondsThreshold = idleMinutesThreshold
    ? idleMinutesThreshold * 60
    : 60;
// console.log(idleSeconds, idleSecondsThreshold);
if (idleSeconds > 0) {
  // idleSeconds = Math.abs(idleSeconds - idleSecondsThreshold);
  if (idleSeconds % 60 !== 0) {
    if (idleSeconds < 60) {
      store.set({ idleSurplusSeconds: idleSeconds });
      idleSeconds = 0;
    } else {
      if (idleSurplusSeconds !== 0) {
        idleSeconds = Math.abs(idleSeconds - idleSurplusSeconds);
      }
    }
  }
}
  // console.log(idleSeconds);
  // console.log("idleMinutesThreshold", idleSecondsThreshold);

  if (idleSeconds > idleSecondsThreshold) {
    // console.log("idle now");
    idleSeconds = await round(idleSeconds);
    store.set({ idleSeconds: idleSeconds });
  } else {
    idleSeconds = 0;
    store.set({ idleSeconds: 0 });
  }
  // console.log(idleSeconds, idleSurplusSeconds);

  let refUrl; //Windows OS URL

  if (is.windows) {
    try {
    const refTitle = extractAppName(activeWindow?.owner?.path);
    if (isBrowser(refTitle)) {
      // console.log("Is a browser");
      // console.log(isBrowserName(refTitle));
      const { getChromeHistory, getFirefoxHistory, getOperaHistory, getAllHistory } = BrowserHistory;
      let browserArray;

      switch (isBrowserName(refTitle)) {
        case "chrome":
          // console.log("chrome")
          browserArray = await getChromeHistory(720);
          break;
            case "firefox":
              // console.log("firefox")
              browserArray = await getFirefoxHistory(720);
              break;
              case "opera":
                // console.log("opera")
                browserArray = await getOperaHistory(720);
                break;
        default:
          browserArray = await getAllHistory(720);
          break;
      }

      let maxStringMatchPoint = 0;

      // console.log(browserArray);
      for (
        let browserIndex = 0;
        browserIndex < browserArray.length;
        browserIndex++
      ) {
        const historyArray = browserArray[browserIndex];
        // console.log(historyArray.length);
        for (
          let historyIndex = 0;
          historyIndex < historyArray.length;
          historyIndex++
        ) {
          const historyUrlObject = historyArray[historyIndex];
          // console.log(historyUrlObject.title);

          const historyTitle = historyUrlObject?.title;

          if (typeof historyTitle === "string") {
            let stringMatchPoint = stringSimilarity.compareTwoStrings(
              historyTitle,
              activeWindow?.title
            );

            if (
              stringMatchPoint > 0.4 &&
              maxStringMatchPoint <= stringMatchPoint
            ) {
              maxStringMatchPoint = stringMatchPoint;
              // console.log(historyUrlObject.title);
              const urlResponse = new URL(historyUrlObject.url);
              refUrl = urlResponse?.hostname;
            }
          }
        }
      }
      // console.log(history);
    }
  } catch (error) {
      console.log(error);
      // console.log("Unable to fetch url");
    }
  }
  // console.log("Active URL:", refUrl);

  let browserUrl; //MacOS URL
  if (activeWindow?.url) {
    const urlObject = new URL(activeWindow?.url);
    browserUrl = urlObject?.hostname;
  }

  const operatingSystem = await getOperatingSystem();

  const { startDate, endDate } = await fetchTimeDetails(organisationTimezone);
  console.log("app", startDate, endDate);

  const appDetails = {
    filePath:
      activeWindow && activeWindow?.owner && activeWindow?.owner?.path
        ? activeWindow?.owner?.path
        : "",
    url: activeWindow ? browserUrl || refUrl : "",
    windowTitle: activeWindow ? activeWindow.title : "",
    idleSeconds: idleSeconds || 0,
    idleSecondsThreshold: idleSecondsThreshold,
    screenshotWidth: width,
    screenshotHeight: height,
    iconWidth: 32,
    iconHeight: 32,
    time,
    timezone: organisationTimezone,
    userId,
    organisationId,
    taskId,
    taskName,
    projectId,
    projectName,
    description: taskDescription,
    taskTimeId,
    startTime: Number(taskStartTime),
    teamId,
    timeString,
    stealthMode: stealthMode === true ? true : false,
    projectManagement: projectManagement === true ? true : false,
    operatingSystem,
    planType,
    startDate,
    endDate
    // idleTimeTestFeature: true
  };

  // console.log(appDetails);

  appDetails.screenshot = screenshotData || "No screenshot available";

  if (activeWindow && (browserUrl || refUrl)) {
    try {
      const image = await Jimp.read(
        `https://s2.googleusercontent.com/s2/favicons?domain_url=${
          browserUrl || refUrl
        }`
      );
      image.getBuffer(Jimp.MIME_PNG, (err, buffer) => {
        appDetails.icon = buffer || "";
      });
    } catch (error) {
      console.log(error);
    }
  } else {
    try {
      appDetails.icon =
        activeWindow && activeWindow?.owner && activeWindow?.owner?.path
          ? (await getIcon(activeWindow?.owner?.path)) || ""
          : "";
    } catch (error) {
      console.log(error);
    }
  }

  // console.log(appDetails.windowTitle);
  // if (screenCapture && includeScreenshot) {
  //   appDetails.screenshot = await getScreenshot();
  //   appDetails.blurScreenCapture = blurScreenCapture;
  // }

  if(!appDetails?.teamId){
    return null;
  }

  const title = appDetails.url
    ? extractHostname(appDetails.url)
    : extractAppName(appDetails.filePath);

  const sortedProductiveArray = productivityStatus?.productiveApps || [];
  const sortedunProductiveArray = productivityStatus?.unProductiveApps || [];

  if (sortedProductiveArray.includes(title)) {
    appDetails.productivityStatus = "productive";
  } else if (sortedunProductiveArray.includes(title)) {
    appDetails.productivityStatus = "unproductive";
  } else {
    appDetails.productivityStatus = "neutral";
  }

  let todayVisitedAppSites = appSites?.todayVisited || [];

  if (todayVisitedAppSites.includes(title)) {
      console.log("Exists");
      appDetails.isVisitedToday = "visited";
  } else {
    todayVisitedAppSites.push(title);
    appDetails.isVisitedToday = "not_visited"
    store.set({appSites: { todayVisited: todayVisitedAppSites}});
  } 

  appDetails.clientDataCallback = true;
  appDetails.lastActivity = lastActivity;
  appDetails.clientTitle = title;

  // if(appDetails.windowTitle === "" && idleSeconds > 60){
  //   return null;
  // }
  console.log(appDetails.productivityStatus, appDetails.isVisitedToday);
  return appDetails;
}

async function getScreenshotWindow(settings, includeScreenshot) {
  const { screenCapture, blurScreenCapture } = settings;

  let screenshot;
  let content;
  let screenshotArray = [];

  if (screenCapture && includeScreenshot) {
    screenshot = await getScreenshot();

    // const directory = app.getPath("userData");
    // const filepath = path.join(directory + "/" + "temp.jpg");

    async function compressScreenshot(screenshot) {
      const directory = app.getPath("userData");
      let filepath;
      for (let index = 0; index < screenshot.length; index++) {
        const displayData = screenshot[index];
        filepath = path.join(directory + "/" + `temp_${index}.jpg`);
        // Read the image.
        const image = await Jimp.read(displayData);
        // Resize the image to width 150 and heigth 150.
        if ((await image.bitmap.height) > 720) {
          await image.resize(Jimp.AUTO, 720);
        }
        await image.quality(50);
  
        if (blurScreenCapture) {
          await image.blur(5);
        }
        // Save and overwrite the image
        await image.writeAsync(filepath);
        content = await fs.readFileSync(filepath);
        screenshotArray.push(content);
      }
    }

    await compressScreenshot(screenshot);

    // content = await Jimp.read(screenshot)
    //   .then((image) => {
    //     image
    //       .quality(10) // set JPEG quality
    //       .blur(3)
    //       .write(filepath); // save
    //   })
    //   .then(() => {
    //     return fs.readFile(filepath, (err, data) => {
    //       return data;
    //     });
    //   })
    //   .catch((err) => {
    //     console.error(err);
    //   });
  }
  console.log(screenshotArray.length)
  return screenshotArray;
}

async function getActivity(args, settings, activity, activityReason, store) {
  const { organisationTimezone, stealthMode, projectManagement } = settings;
  const { userId, organisationId, taskId, taskName, projectId, projectName, taskDescription, taskTimeId, taskStartTime, teamId } = args;
  const time = dayjs.tz(new Date(), organisationTimezone);

  const lastActivity = store.get("lastActivity");

  const operatingSystem = await getOperatingSystem();
  
  const { startDate, endDate } = await fetchTimeDetails(organisationTimezone);
  console.log("work", startDate, endDate);

  return {
    activity,
    time,
    timezone: organisationTimezone,
    userId,
    organisationId,
    teamId,
    taskId,
    taskName,
    projectId,
    projectName,
    description: taskDescription,
    taskTimeId,
    startTime: Number(taskStartTime),
    idleSeconds: 0,
    activityReason,
    stealthMode: stealthMode === true ? true : false,
    projectManagement: projectManagement === true ? true : false,
    operatingSystem,
    startDate,
    endDate,
    clientDataCallback: true,
    lastActivity
  };
}

const toCamel = (s) => {
  return s.replace(/([-_][a-z])/gi, ($1) => {
    return $1.toUpperCase().replace("-", "").replace("_", "");
  });
};

const browsersList = [
  "Google Chrome", // mac
  "chrome", // windows

  "Chromium", // mac
  "chromium", // windows

  "Firefox", // mac
  "firefox", // windows

  "Opera", // mac
  "opera", // windows

  "Brave Browser", // mac
  "brave", // windows

  "Vivaldi", // mac
  "vivaldi", // windows

  "Safari", // mac

  "msedge", // windows
  "iexplore", // windows
];

function isBrowser(browserName) {
  return browsersList.includes(browserName);
}

function isBrowserName(browserName) {
  return browsersList.includes(browserName) ? browserName : false;
}

function extractAppName(filePath) {
  const decodedPath = decodeURI(filePath);
  const filename = decodedPath.replace(/^.*[\\\/]/, "");
  const ext = path.extname(filename);
  return filename.replace(ext, "");
}

function extractHostname(url) {
	if (!url) return null;

	var hostname;
	// find & remove protocol (http, ftp, etc.) and get hostname

	if (url.indexOf("//") > -1) {
		hostname = url.split("/")[2];
	} else {
		hostname = url.split("/")[0];
	}

	//find & remove port number
	hostname = hostname.split(":")[0];
	//find & remove "?"
	hostname = hostname.split("?")[0];

	return hostname;
}

async function fetchTimeDetails(organisationTimezone) {

  moment.tz.setDefault(organisationTimezone);

  let zoneoffset = moment.tz(organisationTimezone).utcOffset();

  let startDate = moment()
    .tz(organisationTimezone)
    .startOf("day")
    .format("YYYY-MM-DD HH:mm:ss");
  let endDate = moment()
    .tz(organisationTimezone)
    .endOf("day")
    .format("YYYY-MM-DD HH:mm:ss");

  if (zoneoffset >= 0) {
    startDate = moment(startDate).subtract(zoneoffset, "minutes").toDate();
    endDate = moment(endDate).subtract(zoneoffset, "minutes").toDate();
  } else {
    zoneoffset = Math.abs(zoneoffset);
    startDate = moment(startDate).add(zoneoffset, "minutes").toDate();
    endDate = moment(endDate).add(zoneoffset, "minutes").toDate();
  }

  startDate = moment(startDate).format("YYYY-MM-DD HH:mm:ss");
  endDate = moment(endDate).format("YYYY-MM-DD HH:mm:ss");

  return {
    startDate,
    endDate,
  };
}

function generateStealthModeScript(store) {
  const stealthSciprtEnabled = store.get("stealthSciprtEnabled");
  if (
    !fs.existsSync(
      path.join(app.getPath("userData") + "/" + "_enterStealth.vbs")
    ) && !fs.existsSync(
      path.join(app.getPath("userData") + "/" + "_enableStealth.bat")
    )
  ) {
  const directory = app.getPath("userData");
  const scriptFilepath = path.join(directory + "/" + "_enterStealth.vbs");
  const enableBatchFilepath = path.join(directory + "/" + "_enableStealth.bat");

  const scriptFileContent = `Set WshShell = CreateObject("WScript.Shell") 
WshShell.Run chr(34) & "_enableStealth.bat" & Chr(34), 0
Set WshShell = Nothing`;

  const enableBatchFileContent = `@echo off
:Start
${app.getPath("exe")}
:: Wait 70 seconds before restarting.
TIMEOUT /T 70
GOTO:Start`;

  try {
    fs.writeFileSync(scriptFilepath, scriptFileContent, "utf-8");
    fs.writeFileSync(enableBatchFilepath, enableBatchFileContent, "utf-8");
    if(stealthSciprtEnabled === false){
    shell.openPath(scriptFilepath);
    store.set("stealthSciprtEnabled", true);
    app.exit();
    }
  } catch (e) {
    console.log("Failed to generate batch file");
  }
}else{
  try {
    if(stealthSciprtEnabled === false){
    shell.openPath(path.join(app.getPath("userData") + "/" + "_enterStealth.vbs"));
    store.set("stealthSciprtEnabled", true);
    app.exit();
  }
  } catch (e) {
    console.log(e);
  }
}
}

function terminateStealthModeScript() {
  if (
    fs.existsSync(
      path.join(app.getPath("userData") + "/" + "_enterStealth.vbs")
    ) && fs.existsSync(
      path.join(app.getPath("userData") + "/" + "_enableStealth.vbs")
    )
  ) {
    const directory = app.getPath("userData");
    const endScriptFilepath = path.join(directory + "/" + "_exitStealth.vbs");
    const disableBatchFilepath = path.join(
      directory + "/" + "_disbaleStealth.bat"
    );

    const endScriptFileContent = `Set WshShell = CreateObject("WScript.Shell") 
WshShell.Run chr(34) & "_disbaleStealth.bat" & Chr(34), 0
Set WshShell = Nothing`;

    const disableBatchFileContent = `taskkill /F /IM cmd.exe`;

    try {
      fs.writeFileSync(endScriptFilepath, endScriptFileContent, "utf-8");
      fs.writeFileSync(disableBatchFilepath, disableBatchFileContent, "utf-8");
      shell.openPath(disableBatchFilepath);

      fs.unlink(app.getPath("userData") + "/" + "_enterStealth.vbs", (err) => {
        if (err) {
            console.log(err);
            // return;
        }
        console.log("File succesfully deleted");
    });
    fs.unlink(app.getPath("userData") + "/" + "_enableStealth.bat", (err) => {
      if (err) {
          console.log(err);
          // return;
      }
      console.log("File succesfully deleted");
  });
  fs.unlink(endScriptFilepath, (err) => {
    if (err) {
        console.log(err);
        // return;
    }
    console.log("File succesfully deleted");
});
fs.unlink(disableBatchFilepath, (err) => {
  if (err) {
      console.log(err);
      // return;
  }
  console.log("File succesfully deleted");
});

    } catch (e) {
      console.log(e);
    }
  }
}

function manualModeScript() {
  if (
    !fs.existsSync(
      path.join(app.getPath("userData") + "/" + "_enterStealth.vbs")
    ) &&
    !fs.existsSync(
      path.join(app.getPath("userData") + "/" + "_enableStealth.bat")
    )
  ) {
    const directory = app.getPath("userData");
    const scriptFilepath = path.join(directory + "/" + "_enterStealth.vbs");
    const enableBatchFilepath = path.join(
      directory + "/" + "_enableStealth.bat"
    );

    const endScriptFilepath = path.join(directory + "/" + "_exitStealth.vbs");
    const disableBatchFilepath = path.join(
      directory + "/" + "_disbaleStealth.bat"
    );

    const scriptFileContent = `Set WshShell = CreateObject("WScript.Shell") 
WshShell.Run chr(34) & "_enableStealth.bat" & Chr(34), 0
Set WshShell = Nothing`;

    const enableBatchFileContent = `@echo off
:Start
${app.getPath("exe")}
:: Wait 20 seconds before restarting.
TIMEOUT /T 20
GOTO:Start`;

    const endScriptFileContent = `Set WshShell = CreateObject("WScript.Shell") 
WshShell.Run chr(34) & "_disbaleStealth.bat" & Chr(34), 0
Set WshShell = Nothing`;

    const disableBatchFileContent = `taskkill /F /IM cmd.exe`;

    try {
      fs.writeFileSync(scriptFilepath, scriptFileContent, "utf-8");
      fs.writeFileSync(enableBatchFilepath, enableBatchFileContent, "utf-8");

      fs.writeFileSync(endScriptFilepath, endScriptFileContent, "utf-8");
      fs.writeFileSync(disableBatchFilepath, disableBatchFileContent, "utf-8");

      shell.openPath(scriptFilepath);
      app.exit();

    } catch (e) {
      console.log("Failed to generate batch file");
    }
  }
}

module.exports = {
  getIcon,
  getScreenshot,
  installExtensions,
  getWindow,
  getScreenshotWindow,
  toCamel,
  getActivity,
  generateStealthModeScript,
  terminateStealthModeScript,
  manualModeScript
};
