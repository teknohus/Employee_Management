require("dotenv").config();
const { notarize } = require("electron-notarize");

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== "darwin") {
    return;
  }

  const appName = context.packager.appInfo.productFilename;

  return await notarize({
    appBundleId: "com.workfolio.desktop",
    appPath: "dist/mac/Workfolio.app",
    appleId: "ganeshpartheeban@designqubearchitects.com",
    appleIdPassword: "6!Z!UPqyCZ3b!DT",
  });
};
