require("dotenv").config();
const {
  app,
  BrowserWindow,
  screen,
  ipcMain,
  dialog,
  Tray,
  Menu,
  powerMonitor,
  shell,
  globalShortcut,
} = require("electron");
const path = require("path");
const os = require("os");
const url = require("url");
// const db = require("./db");
const io = require("socket.io-client");
const { is, openSystemPreferences } = require("electron-util");
const Store = require("electron-store");
const {
  getWindow,
  getScreenshotWindow,
  installExtensions,
  getActivity,
  getScreenshot,
  toCamel,
  // generateStealthModeScript,
  // terminateStealthModeScript,
  // manualModeScript
} = require("./utils");
const jwtDecode = require("jwt-decode");
const log = require("electron-log");
const notifier = require("node-notifier");
const { autoUpdater } = require("electron-updater");
const fs = require("fs");
const usbDetect = require("usb-detection");
const dayjs = require("dayjs");
const { setTimeout } = require("timers");

let mainWindow = null;
let sequelize = null;
let socket = null;
let models = null;
let tray = null;
let trackSchedule = null;
let screenshotSchedule = null;
let stopRetry = null;
let isOnline = null;

function connectToSocketServer(userToken) {
  const userTokenFromStore = store.get("userToken");
  if (!userToken && !userTokenFromStore) {
    return;
  }
  // if(isOnline){
  const endpoint = getEndpoint();
  socket = io(endpoint, {
    transports: ["websocket"],
    upgrade: false,
    reconnectionDelay: 50,
    reconnectionDelayMax: 50,
  });
  // console.log(socket);
  // }
}

function intializeUsbMonitoring() {
  usbDetect.startMonitoring();

  function usbTrack(eventType, device) {
    const userToken = store.get("userToken");
    const userDetails = jwtDecode(userToken);

    const organisationSettings = store.get("organisationSettings");
    const { organisationTimezone } = organisationSettings;
    const addedAt = dayjs.tz(new Date(), organisationTimezone);

    const { userId, organisations } = userDetails;
    const organisationId = organisations[0].id;
    const teamId = organisations[0].teams[0].id;

    const usbTrackObject = {
      eventType,
      deviceName: device.deviceName || "",
      deviceBrand: device.manufacturer || "",
      userId,
      teamId,
      organisationId,
      addedAt,
    };

    console.log("System is", powerMonitor.getSystemIdleState(1));
    if (powerMonitor.getSystemIdleState(1) !== "active" || powerMonitor.getSystemIdleState(1) !== "idle") {
      return;
    }

    socket?.emit("usb_track_activity", emitData(usbTrackObject, { userToken }));
  }

  usbDetect.on("add", function (device) {
    // console.log("USB Device inserted");
    usbTrack("insert", device);
  });

  usbDetect.on("remove", function (device) {
    // console.log("USB Device removed");
    usbTrack("remove", device);
  });
}

const applicationMenuTemplate = [
  {
    label: app.getName(),
    submenu: [
      { label: `About ${app.getName()}`, role: "about", type: "normal" },
      { label: `Version ${app.getVersion()}`, enabled: false, type: "normal" },
      { label: `Quit ${app.getName()}`, role: "quit", type: "normal" },
    ],
    type: "normal",
  },
  {
    label: "File",
    role: "fileMenu",
    type: "normal",
  },
  {
    label: "Edit",
    role: "editMenu",
    type: "normal",
  },
  {
    label: "View",
    submenu: [
      { role: "resetZoom" },
      { role: "zoomIn" },
      { role: "zoomOut" },
      { type: "separator" },
      { role: "togglefullscreen" },
      is.development ? { role: "toggleDevTools", type: "normal" } : {},
      is.development ? { role: "forceReload", type: "normal" } : {},
    ],
    type: "normal",
  },
  {
    label: "Window",
    role: "windowMenu",
    type: "normal",
  },
  {
    label: "Help",
    role: "help",
    submenu: [
      {
        label: "Visit Website",
        click: () => shell.openExternal("https://app.getworkfolio.com"),
      },
    ],
    type: "normal",
  },
];

const contextMenuTemplate = [
  {
    role: "quit",
    accelerator: "Command+Q",
  },
  // { role: "toggleDevTools" },
  {
    role: "Sign out",
    label: "Sign out",
    click: () => stopTracking("stop", "reset_sign_out"),
  },
];

const autoTrackingContextMenuTemplate = [
  // { role: "toggleDevTools" },
  {
    role: "Sign out",
    label: "Sign out",
    click: () => stopTracking("stop", "reset_sign_out"),
  },
];

const assetsPath = path.join(
  __dirname,
  is.development ? "../assets" : "../../assets"
);

const store = new Store({
  encryptionKey: !is.development ? "designQube" : null,
});

store.set("launchAtStart", true);
// store.set("stealthSciprtEnabled", false);
store.delete("currentTask");

const ENDPOINT = "ws://desktop.getworkfolio.com:8000";
// const ENDPOINT = "ws://135.181.229.210:8000";
// const ENDPOINT = "ws://174.138.121.76:8000";
// const ENDPOINT = "ws://localhost:8000";
// const ENDPOINT = "ws://143.110.241.86:7000";
// const ENDPOINT = "https://workfolio.io/api";
// const ENDPOINT = "ws://143.110.241.86:8000";
// const ENDPOINT = "ws://35.154.113.122:8000";
// const ENDPOINT = "ws://3.110.0.240:8000";
// const ENDPOINT = "ws://3.109.157.189:8000";
// const ENDPOINT = "ws://web-socket.workfolio.io:8000";

function getEndpoint() {
  const userToken = store.get("userToken");

  if (!userToken) {
    console.log("not logged in");
  }

  if (userToken) {
    const tokenDecoded = jwtDecode(userToken);
    const now = Math.round(new Date().getTime() / 1000);

    // console.log(tokenDecoded.exp);
    // console.log(now);
    // console.log(tokenDecoded.exp - now);

    if (!tokenDecoded || tokenDecoded.exp - now < 345600) {
      console.log("invalid token / token expired");
      console.log("Restarting application");
      stopTracking("stop", "app_restart");
    }
    return `${ENDPOINT}?authorization=${userToken}`;
  }
  return ENDPOINT;
}

function createWindow(organisationSettings) {
  const startUrl =
    process.env.ELECTRON_START_URL ||
    url.format({
      pathname: path.join(__dirname, "../index.html"),
      protocol: "file:",
      slashes: true,
    });

  const { height, width } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: 700,
    height: Math.round(height * (width > 1367 ? 0.8 : 0.9)),
    fullscreenable: true,
    resizable: false,
    frame: false,
    movable: true,
    // hide app window (for stealth  mode)
    show: true,
    // disable app icon on windows task bar (for stealth mode)
    skipTaskbar: false,
    webPreferences: {
      devTools: is.development,
      nodeIntegration: true,
      preload: path.join(__dirname, "preload.js"),
      // will break on electron v12
      enableRemoteModule: true,
      backgroundThrottling: false,
    },
  });

  mainWindow?.loadURL(startUrl);

  //   mainWindow.loadURL('https://app.workfolio.io/', {
  //   postData: [{
  //     type: 'rawData',
  //     bytes: Buffer.from('hello=world')
  //   }],
  //   extraHeaders: 'Content-Type: application/x-www-form-urlencoded'
  // })
  // mainWindow?.once("ready-to-show", async () => {
  //   autoUpdater.checkForUpdatesAndNotify();
  // });

  mainWindow?.on("close", async function (e) {
    console.log("requesting to close...");

    if (!isOnline) {
      mainWindow?.destroy();
      return;
    }

    const currentTask = store.get("currentTask");

    if (!currentTask) {
      // autoUpdater.checkForUpdatesAndNotify();
      return;
    }

    e.preventDefault();

    const organisationSettings = store.get("organisationSettings");

    if (organisationSettings?.stealthMode === false) {
      let options = {
        buttons: ["Yes", "No", "Cancel"],
        title: "Workfolio",
        message:
          "If you quit the app, the task you are working will be clocked-out and considered as you have stopped working.\n\nAre you sure you want to quit?",
        type: "info",
      };

      const shouldClose = await dialog.showMessageBox(options);

      if (shouldClose.response !== 0) {
        // autoUpdater.checkForUpdatesAndNotify();
        return;
      }
    }

    const workActivity = await getActivity(
      currentTask,
      organisationSettings,
      "stop",
      "app_quit",
      store
    );

    const userToken = store.get("userToken");

    if (!socket) {
      await connectToSocketServer(userToken);
    }
    // if (socket.connected) {
    socket?.emit("work_activity", emitData(workActivity, { userToken }));
    // }
    console.log("closing...");
    store.delete("currentTask");
    if (trackSchedule) {
      clearTracking();
    }
    mainWindow?.destroy();
  });

  mainWindow?.on("closed", function () {
    mainWindow = null;
  });

  mainWindow?.on("unresponsive", function () {
    console.log("app is unresponsive");
    // mainWindow?.reload();
  });

  mainWindow?.on("resize", function () {
    const [width, height] = mainWindow?.getSize();
    mainWindow?.webContents.send("window_size_changed", { width, height });
  });

  mainWindow?.on("focus", function () {
    const currentTask = store.get("currentTask");

    if (!currentTask || currentTask?.activityType === "break") {
      mainWindow?.webContents.send("refresh_current_task");
    }
    // mainWindow?.webContents.send("refresh_current_task");
    mainWindow?.webContents.send("refresh_settings");
    mainWindow?.webContents.send("refresh_app_version");
    mainWindow?.webContents.send("refresh_productivity_status");
    // mainWindow?.webContents.send("refresh_project_details");
    // mainWindow?.webContents.send("refresh");
    // mainWindow?.reload();
  });

  mainWindow?.on("enter-full-screen", function () {
    mainWindow?.webContents.send("window_size_will_change");
  });

  mainWindow?.on("leave-full-screen", function () {
    mainWindow?.webContents.send("window_size_will_change");
  });
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", (event, commandLine, workingDirectory) => {
    // Someone tried to run a second instance, we should focus our window.
    if (mainWindow) {
      if (!mainWindow?.isVisible()) return;
      if (mainWindow?.isMinimized()) mainWindow?.restore();
      mainWindow?.show();
      mainWindow?.focus();
    }
  });

  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("disable-renderer-backgrounding");

  app.on("ready", async () => {
    // if (!is.development) {
    //   globalShortcut.register("CommandOrControl+R", () => {
    //     console.log("CommandOrControl+R is pressed: Shortcut Disabled");
    //   });
    //   globalShortcut.register("F5", () => {
    //     console.log("F5 is pressed: Shortcut Disabled");
    //   });
    //   globalShortcut.register("CommandOrControl+Shift+R", () => {
    //     console.log("F5 is pressed: Shortcut Disabled");
    //   });
    // }

    const organisationSettings = store.get("organisationSettings");
    const currentTask = store.get("currentTask");
    const userToken = store.get("userToken");

    createWindow(organisationSettings);

    if (!userToken) {
      mainWindow?.show();
    }

    if (userToken && organisationSettings?.stealthMode === true) {
      mainWindow?.hide();
      mainWindow?.setSkipTaskbar(true);
    } else if (store.get("autoRestart")) {
      mainWindow?.minimize();
      store.set("autoRestart", false);
    } else {
      mainWindow?.show();
      mainWindow?.setSkipTaskbar(false);
      // terminateStealthModeScript();
    }

    if (
      organisationSettings?.projectManagement &&
      currentTask &&
      !currentTask?.projectId
    ) {
      store.delete("currentTask");
      // mainWindow?.reload();
    }

    // log.transports.console.format = '[{h}:{i}:{s}.{ms}] {text}';
    Object.assign(console, log.functions);

    // open devtools
    if (is.development) {
      try {
        console.log("installing devtools");
        await installExtensions();
      } catch (error) {
        console.log("error installing devtools", error);
      }
    }

    // create database
    // await db.init(app.getPath("userData"));
    // sequelize = db.sequelize;
    // models = await Promise.resolve().then(() => require("./models"));
    // await sequelize.sync();

    // create socket connection
    // if (!socket || !socket?.opts?.query) {
    await connectToSocketServer(userToken);
    // }

    if (organisationSettings?.stealthMode === false) {
      if (userToken) {
        tray = new Tray(path.join(assetsPath, "/workfolio-small.png"));
      }
      mainWindow?.setSkipTaskbar(false);
    } else {
      if (tray) {
        tray.destroy();
      }
      tray = null;
    }

    const contextMenu = Menu.buildFromTemplate(
      organisationSettings && organisationSettings?.stealthMode === true
        ? []
        : contextMenuTemplate
    );

    if (organisationSettings?.stealthMode === false) {
      if (userToken) {
        tray = new Tray(path.join(assetsPath, "/workfolio-small.png"));
        tray.setToolTip("Workfolio");
        tray.setContextMenu(contextMenu);
      }
    } else {
      if (tray) {
        tray.destroy();
      }
      tray = null;
    }

    if (organisationSettings?.usbMonitoring === true) {
      intializeUsbMonitoring();
    }

    if (is.macos) {
      try {
        const applicationMenu = Menu.buildFromTemplate(applicationMenuTemplate);
        Menu.setApplicationMenu(applicationMenu);
      } catch (error) {
        console.log(error);
      }
    }

    // if (store.get("userToken") && store.get("version")) {
    //   store.onDidChange("version", (newAppversion, oldAppVersion) => {
    //     if (store.get("userToken") && store.get("version")) {
    //       showNotification({
    //         title: "Update successful",
    //         message: "Your are currently using the latest version of Workfolio",
    //       });
    //     }
    //   });
    // }

    store.onDidChange(
      "organisationSettings",
      (newOrganisationSettings, oldOrganisationSettings) => {
        if (
          newOrganisationSettings?.stealthMode === true &&
          oldOrganisationSettings?.stealthMode === false
        ) {
          tray?.destroy();
          tray = null;
          mainWindow?.hide();
          mainWindow?.setSkipTaskbar(true);
          // setTimeout(() => {
          //   generateStealthModeScript(store);
          // }, 10000);
          // app.relaunch();
          // app.exit();
        } else {
          if (!tray) {
            tray = new Tray(path.join(assetsPath, "/workfolio-small.png"));
            tray?.setToolTip("Workfolio");
            tray?.setContextMenu(contextMenu);
          }
          mainWindow?.show();
          mainWindow?.setSkipTaskbar(false);
          // setTimeout(() => {
          //   terminateStealthModeScript();
          // }, 10000);
        }
        mainWindow?.reload();
      }
    );

    store.onDidChange(
      "internetStatus",
      (newInternetStatus, oldInternetStatus) => {
        const organisationSettings = store.get("organisationSettings");
        // console.log("new", newInternetStatus);
        // console.log("old", oldInternetStatus);
        if (newInternetStatus === true && oldInternetStatus === false) {
          console.log("Reloading application");
          stopRetry = setInterval(checkInternetAndRetry, 5000);
          setTimeout(() => {
            if (mainWindow) {
              mainWindow?.webContents.send("refresh_current_task");
              // mainWindow?.webContents?.send("refresh");
              mainWindow?.reload();
              if (organisationSettings?.stealthMode === false) {
                mainWindow?.minimize();
              }
            }
          }, 3000);
          // app.relaunch();
          // app.exit();
        }
        // mainWindow?.reload();
        mainWindow?.webContents.send("refresh_current_task");
        // mainWindow?.webContents?.send("refresh");
      }
    );

    socket?.on("connect", () => {
      socket.sendBuffer = [];
      if (socket?.connected) {
        mainWindow?.webContents.send("refresh_current_task");
        console.log(
          "Transport being used: " + socket?.io.engine.transport.name
        );
        const organisationSettings = store.get("organisationSettings");
        if (organisationSettings?.stealthMode === true) {
          console.log("Waiting for timer reload");
          setTimeout(() => {
            console.log("Timer reload event");
            mainWindow?.reload();
          }, 10000);
        }
        mainWindow?.reload();
      }
    });

    socket?.on("reconnect", () => {
      console.log("Reconnecting to socket");
    });

    // socket?.on("connect_error", (e) => {
    //   if (isOnline) {
    //   console.log(e);
    //   }
    // });

    socket?.on("disconnect", (reason) => {
      console.log("Disconnected due to", reason);
      const userToken = store.get("userToken");
      if (
        reason === "io server disconnect" ||
        reason === "transport close" ||
        reason === "ping timeout" ||
        reason === "io client disconnect"
      ) {
        // if (!socket || !socket?.opts?.query) {
        // connectToSocketServer(userToken);
        // }
      }
      // else the socket will automatically try to reconnect
    });

    socket?.on("update_settings", (data) => {
      try {
        const organisationData = data.reduce((acc, curr) => {
          let val = curr.value;
          if (curr.valueType === "boolean") {
            val = curr.value === "true";
          }
          if (curr.valueType === "number") {
            val = Number(curr.value);
          }
          acc[toCamel(curr.featureName)] = val;
          return acc;
        }, {});

        const organisationSettings = store.get("organisationSettings");
        const updatedOrganisationSettings = {
          ...organisationSettings,
          ...organisationData,
        };

        store.set({ organisationSettings: updatedOrganisationSettings });
        if (updatedOrganisationSettings?.usbMonitoring === true) {
          usbDetect.stopMonitoring();
          intializeUsbMonitoring();
        } else {
          usbDetect.stopMonitoring();
        }
        screenshotSchedule = 1;
        if (updatedOrganisationSettings?.stealthMode === true) {
          mainWindow?.hide();
          mainWindow?.setSkipTaskbar(true);
          // console.log("stealth mode on");
          tray?.destroy();
          tray = null;
        } else {
          tray = new Tray(path.join(assetsPath, "/workfolio-small.png"));
          tray?.setToolTip("Workfolio");
          tray?.setContextMenu(contextMenu);
          mainWindow?.show();
          mainWindow?.setSkipTaskbar(false);
        }
        mainWindow?.reload();
      } catch (error) {
        console.log(error);
      }
    });

    socket?.on("send_log_file", () => {
      console.log("generating log file");
      try {
        const userToken = store.get("userToken");
        const logFilePath = log.transports.file.getFile().path;
        const logData = fs.readFileSync(logFilePath, "utf8");
        const logString = logData.toString();
        const userDetails = jwtDecode(userToken);
        const { emailId } = userDetails;
        const logObject = {
          email: emailId,
          logString,
        };
        socket?.emit("submit_log_file", emitData(logObject, { userToken }));
      } catch (e) {
        console.log("Error submitting log file:", e.stack);
      }
    });

    socket?.on("stop_tracking_client", () => {
      const organisationSettings = store.get("organisationSettings");
      try {
        stopTracking("stop", "auto_clock_out");
        mainWindow?.reload();
        if (organisationSettings?.stealthMode === false) {
          mainWindow?.show();
        }
      } catch (e) {
        console.log(e);
      }
    });

    socket?.on("reset_user_account", () => {
      console.log("reset app data");
      try {
        stopTracking("stop", "reset_sign_out");
        return true;
      } catch (e) {
        console.log(e);
      }
    });

    socket?.on("server_maintenance_alert", (maintenanceStatus) => {
      console.log("Server maintenance alert");
      try {
        if (maintenanceStatus) {
          stopTracking("stop", "server_maintenance");
        }
        mainWindow?.reload();
      } catch (e) {
        console.log(e);
      }
    });

    socket?.on("user_tracking_started", () => {
      console.log("server sent a start reload");
      try {
        // if (
        //   organisationSettings?.stealthMode === false &&
        //   mainWindow?.isVisible()
        // ) {
        // setTimeout(() => {
          // mainWindow?.webContents.send("refresh_current_task");
          mainWindow?.webContents.send("refresh_settings");
          mainWindow?.webContents.send("refresh_app_version");
        //   mainWindow?.webContents.send("refresh");
        // }, 1000);

        // mainWindow?.reload();
        // } else {
        //   setTimeout(() => {
        //     mainWindow?.reload();
        //   }, 3000);
        // }
      } catch (e) {
        console.log(e);
      }
    });

    socket?.on("user_tracking_stopped", () => {
      console.log("server sent a stop reload");
      try {
        // if (
        //   organisationSettings?.stealthMode === false &&
        //   mainWindow?.isVisible()
        // ) {
        //   setTimeout(() => {
            mainWindow?.webContents.send("refresh_current_task");
            mainWindow?.webContents.send("refresh_settings");
            mainWindow?.webContents.send("refresh_app_version");
            // mainWindow?.webContents.send("refresh");
        //   }, 3000);
        // } else {
        //   setTimeout(() => {
        //     mainWindow?.reload();
        //   }, 3000);
        // }
      } catch (e) {
        console.log(e);
      }
    });

    socket?.on("work_event_server_data", (data) => {
      if (data) {
        console.log("work_event_server_data", data);
        store.set("lastActivity", data);
      }
    });

    socket?.on("app_event_server_data", (data) => {
      if (data) {
        console.log("app_event_server_data", data);
        store.set("lastActivity", data);
      }
    });

    // socket?.on("request_screenshot", () => {
    //   console.log("requesting screen emit event");;
    //   try {
    //     const requestEvent = trackWindow(timer = 0, type = "request");
    //   } catch (e) {
    //     console.log(e);
    //   }
    // });
  });

  // manualModeScript();
}

if ((is.macos || is.windows) && !is.development) {
  app.setLoginItemSettings({
    openAtLogin: store.get("launchAtStart"),
    // path: path.join(app.getPath("userData") + "/" + "_enterStealth.vbs")
  });
}

app.on("quit", async (e) => {
  usbDetect.stopMonitoring();
  console.log("quit");

  const currentTask = store.get("currentTask");

  if (!currentTask) {
    // autoUpdater.checkForUpdatesAndNotify();
    return;
  }

  e.preventDefault();

  const organisationSettings = store.get("organisationSettings");

  const workActivity = await getActivity(
    currentTask,
    organisationSettings,
    "stop",
    "app_quit",
    store
  );

  const userToken = store.get("userToken");
  if (!socket) {
    await connectToSocketServer(userToken);
  }
  // if (socket.connected) {
  socket?.emit("work_activity", emitData(workActivity, { userToken }));
  // }
  console.log("closing...");
  store.delete("currentTask");
  if (trackSchedule) {
    clearTracking();
  }
});

app.on("window-all-closed", function () {
  app.quit();
});

ipcMain.on("online_status_changed", (_event, status) => {
  isOnline = status === "online";
  console.log("internet connection changed to", isOnline);
  if (isOnline) {
    mainWindow?.webContents.send("refresh_current_task");
    // mainWindow?.webContents?.send("refresh");
  }
});

ipcMain.on("get_window_size", (event) => {
  const [width, height] = mainWindow?.getSize();
  event.reply("window_size_changed", { width, height });
  // const organisationSettings = store.get("organisationSettings");
  // if (
  //   organisationSettings?.projectManagement &&
  //   !mainWindow?.fullScreen &&
  //   width !== 700
  // ) {
  //   app.relaunch();
  //   app.exit();
  // }
});

ipcMain.on("window_close", () => {
  store.delete("checkForUpdates");
  mainWindow?.close();
});

ipcMain.on("request_permission", async (event) => {
  try {
    if (is.macos) {
      const organisationSettings = store.get("organisationSettings");

      if (!organisationSettings.screenCapture) {
        event.reply("permission", true);
        return;
      }

      const permissions = await Promise.resolve().then(() =>
        require("node-mac-permissions")
      );

      const screenCapturePermission = permissions.getAuthStatus("screen");
      const hasScreenCapturePermission =
        screenCapturePermission === "authorized";

      const accessibilityPermission =
        permissions.getAuthStatus("accessibility");
      const hasAccessibilityPermission =
        accessibilityPermission === "authorized";

      if (!hasScreenCapturePermission || !hasAccessibilityPermission) {
        if (organisationSettings?.stealthMode === true) {
          mainWindow?.show();
          mainWindow?.setSkipTaskbar(false);
        }
        let message =
          'Please allow "Workfolio" in the Screen Recording and Accessibility preferences';

        if (!hasScreenCapturePermission && hasAccessibilityPermission) {
          message =
            'Please allow "Workfolio" in the Screen Recording preference';
        }

        if (hasScreenCapturePermission && !hasAccessibilityPermission) {
          message = 'Please allow "Workfolio" in the Accessibility preference';
        }

        event.reply("permission", false);

        let options = {
          buttons: ["Ok", "Cancel"],
          title: "Workfolio",
          message,
          type: "info",
        };

        const willAllow = await dialog.showMessageBox(options);

        if (willAllow.response === 0) {
          await getWindow({}, organisationSettings, true);
          await getScreenshot();

          if (!hasScreenCapturePermission) {
            console.log("askForScreenCaptureAccess");
            openSystemPreferences("security", "Privacy_ScreenCapture");
          }

          if (!hasAccessibilityPermission) {
            console.log("askForAccessibilityAccess");
            openSystemPreferences("security", "Privacy_Accessibility");
          }
        }

        app.quit();

        return;
      }

      // event.reply("permission", true);
    }

    if (socket && socket?.connected) {
      event.reply("permission", true);
    } else {
      event.reply("permission", false);
    }
  } catch (error) {
    event.reply("permission", false);
  }
});

ipcMain.on("disable_screencapture", (_event, value) => {
  // console.log(
  //   value ? `${value} - Disabling Screencapture` : "Enabling Screencapture"
  // );
  // store.set("disableScreenCapture", value ? true : false);
  store.set("disableScreenCapture", false);
});

ipcMain.handle("set_store_value", (_event, ...args) => {
  // console.log("setting refetched store value");
  return store.set(...args);
});

ipcMain.handle("get_store_value", (_event, key) => {
  // console.log("getting store value");
  return store.get(key);
});

ipcMain.handle("delete_store_value", (_event, key) => {
  // console.log("deleting store value");
  if (key === "currentTask" && store.get("currentTask")) {
    // console.log(
    //   "current Task rendered null from server - restarting app after auto clock out"
    // );
    stopTracking("stop", "socket_timeout");
    mainWindow?.reload();
    return;
  }
  return store.delete(key);
});

ipcMain.handle("reset_store_value", (_event) => {
  return store.clear();
});

ipcMain.handle("start_tracking", async (_event, args) => {
  console.log("Start work called");
  mainWindow?.webContents.send("refresh_current_task");
  mainWindow?.webContents.send("refresh_settings");
  mainWindow?.webContents.send("refresh_app_version");
  // mainWindow?.webContents.send("refresh");
  // mainWindow?.webContents.send("refresh_current_task");

  try {
    const organisationSettings = store.get("organisationSettings");
    const previousProjectDetails = store.get("previousProjectDetails");
    // const lastActivity = store.get("lastActivity") || {};

    const {
      trackAppsAndWebsites = false,
      stealthMode = false,
      projectManagement = false,
      screenCapture = false,
    } = organisationSettings;

    // console.log(previousProjectDetails);
    if (
      projectManagement &&
      previousProjectDetails?.previousProjectId &&
      !args?.projectId
    ) {
      args.projectId = previousProjectDetails?.previousProjectId;
      args.projectName = previousProjectDetails?.previousProjectName;
      args.description = previousProjectDetails?.previousTaskDescription;
    }

    if (
      projectManagement &&
      previousProjectDetails?.previousTaskId &&
      !args?.taskId
    ) {
      args.taskId = previousProjectDetails?.previousTaskId;
      args.taskName = previousProjectDetails?.previousTaskName;
    }
    // console.log(args);

    if (stealthMode === true) {
      mainWindow?.hide();
      mainWindow?.setSkipTaskbar(true);
    } else {
      // mainWindow?.show();
    }

    // if (!trackAppsAndWebsites) {
    //   throw new Error("tracking not enabled");
    // }

    const timer = 60000;

    if (trackSchedule) {
      // throw new Error("work already started");
      console.log("work already started");
      console.log("resetting work schedule");
      await clearTracking();
      setTimeout(() => {
        // if (trackAppsAndWebsites) {
        //   trackSchedule = setInterval(trackWindow(timer), timer);
        // }
        console.log("clearing old schedule");
      }, 1000);
      // return;
    }

    if (!trackSchedule) {
      const userToken = store.get("userToken");
      const workActivity = await getActivity(
        args,
        organisationSettings,
        "start",
        null,
        store
      );
      // console.log(workActivity);
      let currentSystemState = await powerMonitor.getSystemIdleState(1);
      console.log("System is", currentSystemState);

      if (currentSystemState === "locked") {
        return;
      }

      console.log("System is not locked ... progress to emit event");

      if (!socket) {
        await connectToSocketServer(userToken);
      }
      // if (socket.connected) {
      socket?.emit("work_activity", emitData(workActivity, { userToken }));
      // }
      if (projectManagement && args?.projectId) {
        store.set({
          previousProjectDetails: {
            previousProjectId: args?.projectId,
            previousProjectName: args?.projectName,
            previousTaskId: args?.taskId,
            previousTaskName: args?.taskName,
            previousTaskDescription: args?.taskDescription || args?.description,
          },
        });
      }

      store.set({
        currentTask: {
          ...args,
          updatedAt: new Date(),
          activityType: "start",
        },
      });

      store.set("currentTeamId", args.teamId);

      if (organisationSettings?.screenCapture) {
        screenshotSchedule = 1;
      }

      console.log("starting work with", timer, "ms");

      if (trackAppsAndWebsites) {
        trackSchedule = setInterval(trackWindow, timer, timer, "schedule");
      }
    }

    if (tray) {
      if (organisationSettings?.stealthMode === true) {
        tray.destroy();
        tray = null;
        mainWindow?.setSkipTaskbar(true);
      } else {
        tray.setImage(path.join(assetsPath, "/workfolio-online.png"));
      }
    } else {
      if (organisationSettings?.stealthMode === false) {
        tray = new Tray(path.join(assetsPath, "/workfolio-online.png"));
        tray.setToolTip("Workfolio");
        tray.setContextMenu(contextMenu);
      }
    }

    store.delete("idleSurplusSeconds");
    store.delete("offlineKey");

    // if (organisationSettings?.stealthMode === true) {
    //   setTimeout(() => {
    //     generateStealthModeScript(store);
    //   }, 10000);
    // }

    return true;
  } catch (error) {
    console.log(error);
    return false;
  }
});

ipcMain.handle("stop_tracking", (_event, activityType, activityReason) => {
  try {
    console.log("Stop event was called");
    stopTracking(activityType, activityReason);
    return true;
  } catch (error) {
    console.log(error);
    return false;
  }
});

ipcMain.on("check_for_app_updates", () => {
  try {
    const shouldCheckForUpdate = store.get("checkForUpdates");
    if (shouldCheckForUpdate) return true;
    if (!shouldCheckForUpdate) store.set({ checkForUpdates: true });
    console.log("checking for updates");
    autoUpdater.checkForUpdatesAndNotify();
  } catch (error) {
    console.log(error);
  }
});

ipcMain.on("jwt_token_expired", () => {
  try {
    console.log("Restarting application");
    stopTracking("stop", "app_restart");
    mainWindow?.focus();
  } catch (error) {
    console.log(error);
  }
});

ipcMain.on("open_chat_support", () => {
  try {
    shell.openExternal("https://tawk.to/workfolio");
  } catch (error) {
    console.log(error);
  }
});

ipcMain.on("open_external_link", (_event, data) => {
  try {
    if (data === "https://app.getworkfolio.com/home") {
      // _event.preventDefault();
      return;
    }
    shell.openExternal(data);
  } catch (error) {
    console.log(error);
  }
});

ipcMain.on("reload_application", () => {
  console.log("Reloading application");
  try {
    mainWindow?.reload();
  } catch (error) {
    console.log(error);
  }
});

ipcMain.on("send_log", (_event, data) => {
  try {
    console.log("Sending bug report/log");
    const userToken = store.get("userToken");
    const logFilePath = log.transports.file.getFile().path;
    const logData = fs.readFileSync(logFilePath, "utf8");
    const logString = logData.toString();
    const logObject = {
      email: data,
      logString,
    };
    socket?.emit("submit_log_file", emitData(logObject, { userToken }));
    showNotification({
      title: "Bug report sent",
      message: "We have received your bug report 👍",
    });
  } catch (e) {
    console.log("Error:", e.stack);
  }
});

// ipcMain.on("request_screenshot", () => {
//   console.log("requesting screen emit event");;
//       try {
//         const requestEvent = trackWindow(timer = 0, type = "request");
//       } catch (e) {
//         console.log(e);
//       }
// });

ipcMain.on("open_forgot_password_link", () => {
  try {
    shell.openExternal("https://app.getworkfolio.com/forgot-password");
  } catch (error) {
    console.log(error);
  }
});

ipcMain.on("restart_application", () => {
  try {
    console.log("Restarting application");
    stopTracking("stop", "app_restart");
    app.relaunch();
    app.exit();
  } catch (error) {
    console.log(error);
  }
});

ipcMain.on("reset_sign_out", () => {
  try {
    console.log("Log out & Restart application");
    stopTracking("stop", "reset_sign_out");
  } catch (error) {
    console.log(error);
  }
});

ipcMain.on("focus_app_window", () => {
  try {
    console.log("Focusing application");
    mainWindow?.focus();
  } catch (error) {
    console.log(error);
  }
});

ipcMain.on("send_console_event", (_event, data) => {
  try {
    // console.log(data);
    if (isOnline) {
      // mainWindow?.webContents?.send("refresh");
      // mainWindow?.reload();
    }
  } catch (e) {
    console.log("Error:", e.stack);
  }
});

ipcMain.on("user_login_success", async () => {
  console.log("User login successful");
  const organisationSettings = store.get("organisationSettings");
  const userToken = store.get("userToken");

  if (organisationSettings?.stealthMode === true) {
    mainWindow?.hide();
    mainWindow?.setSkipTaskbar(true);
  } else {
    mainWindow?.show();
  }
  mainWindow?.reload();
  if (!socket) {
    await connectToSocketServer(userToken);
  }
});

ipcMain.handle("start_task", async (_event, args) => {
  try {
    console.log("Start task was called");

    const currentTask = store.get("currentTask");

    if (!currentTask) return;

    const { taskId, projectId, ...restTask } = currentTask;

    const taskStatus = Object.keys(args).length > 0 ? "start" : "stop";

    const organisationSettings = store.get("organisationSettings");
    // if starting a new task and there is some other task already exists, stop it first
    // if (taskStatus === "start" && taskId && projectId) {
    //   const taskActivity = await getActivity(
    //     currentTask,
    //     organisationSettings,
    //     "stop"
    //   );
    //   const userToken = store.get("userToken");
    //   socket?.emit("task_activity", emitData(taskActivity, { userToken }));
    // }

    const updatedTask = {
      ...restTask,
      ...args,
    };

    // const taskActivity = await getActivity(
    //   taskStatus === "start" ? updatedTask : currentTask,
    //   organisationSettings,
    //   taskStatus
    // );

    // socket?.emit("task_activity", emitData(taskActivity, { userToken }));

    store.set({ currentTask: updatedTask });

    return true;
  } catch (error) {
    console.log(error);
    return false;
  }
});

// windows, mac
powerMonitor.on("suspend", () => {
  try {
    if (trackSchedule) {
      stopTracking("stop", "system_suspend");
      // socket?.disconnect();
    }
  } catch (err) {
    console.log(err);
  }
  console.log("System is", powerMonitor.getSystemIdleState(1));
  console.log("suspend");
});

// windows, mac
powerMonitor.on("resume", () => {
  console.log("System is", powerMonitor.getSystemIdleState(1));
  console.log("resume");
  // store.delete("currentTask");
  // clearTracking();
  store.set("autoRestart", true);
  setTimeout(() => {
    if (mainWindow?.isVisible()) {
      mainWindow?.show();
    }
  }, 10000);
  // app.relaunch();
  // app.exit();
  mainWindow?.reload();
});

// linux, mac
powerMonitor.on("shutdown", () => {
  try {
    if (trackSchedule) {
      stopTracking("stop", "system_shutdown");
      // socket?.disconnect();
    }
  } catch (err) {
    console.log(err);
  }
  console.log("System is", powerMonitor.getSystemIdleState(1));
  console.log("shutdown");
});

// windows, mac
powerMonitor.on("lock-screen", () => {
  console.log(Math.floor(powerMonitor.getSystemIdleTime()));
  try {
    if (trackSchedule) {
      stopTracking("stop", "system_locked");
      // socket?.disconnect();
    }
  } catch (err) {
    console.log(err);
  }
  console.log("System is", powerMonitor.getSystemIdleState(1));
  console.log("lock-screen");
});

// windows, mac
powerMonitor.on("unlock-screen", () => {
  console.log("System is", powerMonitor.getSystemIdleState(1));
  console.log("unlock-screen");
  // store.delete("currentTask");
  // clearTracking();
  store.set("autoRestart", true);
  mainWindow?.reload();
  // app.relaunch();
  // app.exit();
});

// autoUpdater.on("update-available", () => {
//   showNotification({
//     title: "Workfolio update",
//     message: "A new update is available. Downloading now...",
//   });
// });

autoUpdater.on("update-downloaded", async () => {
  // let options = {
  //   buttons: ["Update and Restart App", "Cancel"],
  //   title: "Workfolio Update",
  //   message: "Update available. It will be installed on restart",
  //   detail: "Restart now?",
  //   type: "info",
  // };

  // const shouldRestart = await dialog.showMessageBox(options);

  // if (shouldRestart.response === 0) {
  await stopTracking("stop", "before_update");
  // showNotification({
  //   title: "A new version of the app is available",
  //   message: "App will now restart & install automatically",
  // });
  setTimeout(() => {
    setImmediate(() => {
      autoUpdater.quitAndInstall();
    });
  }, 1000);
  // }
});

function checkInternetAndRetry() {
  if (isOnline) {
    mainWindow?.webContents?.send("refresh_current_task");
    // mainWindow?.reload();
    // while(isOnline){
    //   mainWindow?.reload();
    // }
    clearInterval(stopRetry);
    stopRetry = null;
  }
}

async function trackWindow(timer, type = "track") {
  // return async () => {
    try {
      // console.log("emit app change event");
      const userToken = store.get("userToken");
      const productivityStatusSettings = store.get("productivityStatus");
      const userDetails = jwtDecode(userToken);

      let currentSystemState = await powerMonitor.getSystemIdleState(1);
      console.log("System is", currentSystemState);
      
      if (currentSystemState === "locked") {
        stopTracking("stop", "system_locked");
        return;
      }

      const currentTask = await store.get("currentTask");

      const { userId } = userDetails || {};

      if (!userId) {
        throw new Error("no user details");
      }

      console.log("user found");

      let includeScreenshot = false;

      const organisationSettings = store.get("organisationSettings");
      
      if(productivityStatusSettings && Object.keys(productivityStatusSettings).length === 0){
        mainWindow?.webContents.send("refresh_productivity_status");
      }

      if (!currentTask && organisationSettings?.stealthMode !== true) {
        // clearTracking();
        mainWindow?.reload();
        return;
        // mainWindow?.webContents?.send("refresh_current_task");
        // throw new Error("current task does not exists");
      }

      console.log("currently online");

      // if (currentTask.activityType !== "start" || currentTask.activityType !== "break") {
      //   throw new Error("work is not started");
      // }

      if(type !== "request"){
      store.set({
        currentTask: {
          ...currentTask,
          taskTimer: currentTask.taskTimer + timer / 1000,
        },
      });
    }
      console.log("updated store details");

      if (organisationSettings?.stealthMode === true) {
        // if (mainWindow?.isVisible()) {
        mainWindow?.hide();
        mainWindow?.setSkipTaskbar(true);
        // }
      }
      
      // console.log("screenshot is enabled ", organisationSettings.screenCapture)
      // console.log("screenshot is included ", includeScreenshot)
      // console.log("screenshot schedule ", screenshotSchedule)
      // console.log("screenshot interval ", organisationSettings.screenCaptureInterval)

      if (organisationSettings?.screenCapture && screenshotSchedule === null) {
        screenshotSchedule = 1;
      }
      // console.log("screenshot schedule change ", screenshotSchedule)
      
      if (organisationSettings?.screenCapture) {
        // const screenshotIntervalMS =
        //   organisationSettings.screenCaptureInterval * 60000;
        // const screenshotTimer = screenshotIntervalMS / timer;
        includeScreenshot =
          screenshotSchedule === organisationSettings.screenCaptureInterval
            ? true
            : false;
      }
      // console.log("screenshot is included changed to ", includeScreenshot)
      // emit the app change and store it in lastActiveWindow
      if (!isOnline) {
        // store to local DB
        // if (!sequelize) {
        //   throw new Error("no database instance");
        // }

        console.log("storing locally offline");
        const offlineKey = store.get("offlineKey");

        if (!offlineKey) {
          console.log("system is offline");
          store.set({ offlineKey: true });
          stopTracking("stop", "system_offline");
          mainWindow?.reload();
          // mainWindow?.show();
          // mainWindow?.focus();
        }

        // console.log(appDetails);

        // models.userVisitedSites
        //   .create(appDetails)
        //   .then(() => console.log("added a visited site"));
      } else {
        console.log("system is online");
        const offlineKey = store.get("offlineKey");

        if (offlineKey) {
          store.delete("offlineKey");
          // mainWindow?.reload();
          // const args = store.get("currentTask");
          // stopTracking("stop","system_online");
          // setTimeout(() => {
          //   try {
          //     const userToken = store.get("userToken");
          //     const organisationSettings = store.get("organisationSettings");

          //     const { trackAppsAndWebsites = false } = organisationSettings;

          //     const workActivity = getActivity(
          //       args,
          //       organisationSettings,
          //       "start"
          //     );
          //     socket?.emit(
          //       "work_activity",
          //       emitData(workActivity, { userToken })
          //     );

          //     if (!trackAppsAndWebsites) {
          //       throw new Error("tracking not enabled");
          //     }

          //     const timer = 60000;

          //     if (trackSchedule) {
          //       throw new Error("tracking already started");
          //     }

          //     if (!trackSchedule) {
          //       console.log("starting track with", timer, "ms");
          //       showNotification({
          //         title: "Started ⏱",
          //         message: "You have started working...",
          //       });
          //       screenshotSchedule = 1;
          //       store.set({
          //         currentTask: {
          //           ...args,
          //           updatedAt: new Date(),
          //           activityType: "start",
          //         },
          //       });
          //       trackSchedule = setInterval(trackWindow(timer), timer);
          //     }

          //     if (tray) {
          //       tray.setImage(path.join(assetsPath, "/workfolio-online.png"));
          //     }

          //     mainWindow?.reload();
          //     return true;
          //   } catch (error) {
          //     console.log(error);
          //     return false;
          //   }
          // }, 1000);
        }

        let currentSystemState = await powerMonitor.getSystemIdleState(1);
        console.log("System is", currentSystemState);
        
        if (currentSystemState === "locked") {
          stopTracking("stop", "system_locked");
          return;
        }

        const appDetails = await getWindow(
          currentTask,
          organisationSettings,
          store,
          includeScreenshot
        );
        // console.log(appDetails);

        if (!appDetails) {
          // socket?.disconnect();
          mainWindow?.reload();
          return;
        }

        // console.log("Include screenshot value is", includeScreenshot);

        if (includeScreenshot || (type && type === "request")) {
          screenshotSchedule = 1;
          console.log("emit screen event");
          let currentSystemState = await powerMonitor.getSystemIdleState(1);
          console.log("System is", currentSystemState);
          
          if (currentSystemState === "locked") {
            stopTracking("stop", "system_locked");
            return;
          }
          if (!socket) {
            await connectToSocketServer(userToken);
          }

          const screenshotArray = appDetails.screenshot;
          for (
            let screenshotArrayIndex = 0;
            screenshotArrayIndex < screenshotArray.length;
            screenshotArrayIndex++
          ) {
            const screenshotData = screenshotArray[screenshotArrayIndex];
            appDetails.screenshot = screenshotData;
            // if (socket.connected) {
            socket?.emit(
              "screenshot_activity",
              emitData(appDetails, { userToken })
            );
            // }
          }
        } else {
          if (organisationSettings.screenCapture) {
            screenshotSchedule = (screenshotSchedule || 1) + 1;
          }
        }

        delete appDetails.screenshot;

        // appDetails.clientDataCallback = true;

        // console.log("Terminating screen emit request call");
        if(type === "request") return;

        console.log("emit app change event");
        let latestSystemState = await powerMonitor.getSystemIdleState(1);
        console.log("System is", latestSystemState);
        
        if (latestSystemState === "locked") {
          stopTracking("stop", "system_locked");
          return;
        }
        if (!socket) {
          await connectToSocketServer(userToken);
        }
        // if (socket.connected) {
        socket?.emit("app_change", emitData(appDetails, { userToken }));
        // }
        //Idle second auto-clock-out block
        if (
          !organisationSettings?.stealthMode ||
          organisationSettings?.stealthMode === false
        ) {
          const totalIdleSeconds = store.get("idleSeconds");
          const organisationIdleMinutes = organisationSettings?.idleMinutes;
          const organisationIdleMinutesThreshold =
            organisationSettings?.idleMinutesThreshold;
          if (!organisationIdleMinutes || isNaN(organisationIdleMinutes)) {
            return;
          }
          const organisationIdleSeconds = organisationIdleMinutes * 60;
          const organisationIdleSecondsThreshold =
            organisationIdleMinutesThreshold
              ? organisationIdleMinutesThreshold * 60
              : 0;

          if (
            totalIdleSeconds >= organisationIdleSeconds - 60 &&
            totalIdleSeconds <= organisationIdleSeconds - 20
          ) {
            showNotification({
              title: "Are you still working ?",
              message: "Your work will stop automatically in a few seconds !",
            });
          }
          if (
            totalIdleSeconds >=
            organisationIdleSeconds + organisationIdleSecondsThreshold
          ) {
            stopTracking("stop", "idle_time_exceeded");
            store.delete("idleSeconds");
            mainWindow?.reload();
            mainWindow?.focus();
          }
        }

        // console.log(appDetails);
      }
    } catch (error) {
      console.log("ERROR", error);
    }
  // };
}

function emitData(data, additionalFields) {
  return {
    ...data,
    ...additionalFields,
    device: os.platform(),
  };
}

function showNotification(notification, callback) {
  const organisationSettings = store.get("organisationSettings");
  if (organisationSettings?.stealthMode === false) {
    notifier.notify(
      {
        sound: "Pop",
        appID: "com.workfolio.desktop",
        ...notification,
      },
      callback
    );
  }
}

function clearTracking() {
  console.log("stopping work");
  clearInterval(trackSchedule);
  trackSchedule = null;
  screenshotSchedule = null;
}

async function stopTracking(activityType, activityReason) {
  try {
    console.log(activityReason);

    console.log("System is", powerMonitor.getSystemIdleState(1));

    const userToken = store.get("userToken");
    const organisationSettings = store.get("organisationSettings");
    const currentTask = store.get("currentTask");

    if (organisationSettings?.projectManagement && currentTask?.projectId) {
      console.log("Project Stop Call");
      await mainWindow?.webContents.send("clock_out_project");
    }

    if (activityReason === "clock_out") {
      store.delete("previousProjectDetails");
    }

    if (
      activityReason === "reset_sign_out" ||
      activityReason === "app_restart"
    ) {
      console.log("Clearing store values");
      store.clear();
      const win = BrowserWindow.getAllWindows()[0];
      const ses = win.webContents.session;
      ses.clearCache(() => {
        alert("Cache cleared!");
      });
      mainWindow?.reload();
      app.relaunch();
      app.quit();
    }

    if (!currentTask) {
      console.log("no current task");
    }

    // if (currentTask.taskId) {
    //   const taskActivity = await getActivity(
    //     currentTask,
    //     organisationSettings,
    //     "stop",
    //     activityReason
    //   );
    //   socket?.emit("task_activity", emitData(taskActivity, { userToken }));
    // }

    const workActivity = await getActivity(
      currentTask,
      organisationSettings,
      activityType,
      activityReason,
      store
    );
    // console.log(workActivity);
    console.log("System is", powerMonitor.getSystemIdleState(1));
    if (
      powerMonitor.getSystemIdleState(1) === "active" &&
      (activityReason === "system_suspend" ||
        activityReason === "system_suspend" ||
        activityReason === "system_shutdown")
    ) {
      return;
    }
    if (!socket) {
      await connectToSocketServer(userToken);
    }
    // if (socket.connected) {
    socket?.emit("work_activity", emitData(workActivity, { userToken }));
    // }
    if (
      activityReason !== "socket_timeout" ||
      activityReason !== "before_update"
    ) {
      // showNotification({
      //   title: activityType === "stop" ? "Stopped ⏹" : "At break ⏸",
      //   message:
      //     activityType === "stop"
      //       ? "You have stopped working..."
      //       : "You have taken a break...",
      // });
    }

    if (tray) {
      if (organisationSettings?.stealthMode === true) {
        tray.destroy();
        tray = null;
      } else {
        tray.setImage(path.join(assetsPath, "/workfolio-small.png"));
      }
    } else {
      if (organisationSettings?.stealthMode === false) {
        tray = new Tray(path.join(assetsPath, "/workfolio-small.png"));
        tray.setToolTip("Workfolio");
        tray.setContextMenu(contextMenu);
      }
    }

    clearTracking();

    if (!activityType || activityType === "stop") {
      store.delete("currentTask");
      return true;
    }

    const updatedTask = {
      ...currentTask,
      updatedAt: new Date(),
      activityType,
    };

    store.set({ currentTask: updatedTask });

    return true;
  } catch (error) {
    console.log(error);
    return false;
  }
}
