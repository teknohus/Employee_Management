const sqlite3 = require("sqlite3");
const path = require("path");
const fs = require("fs");
const util = require("util");
const Sequelize = require("sequelize");

const promisified = {
  rename: util.promisify(fs.rename),
  unlink: util.promisify(fs.unlink),
  exists: util.promisify(fs.exists),
};

// Validating database before system is inited so it can be prevented
function verifyDatabase(filename) {
  return new Promise(
    (resolve, reject) =>
      new sqlite3.Database(filename, sqlite3.OPEN_READWRITE, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve("DB is good");
      })
  );
}

async function init(appPath) {
  const storage = path.join(appPath, "storage");

  try {
    let exists = await promisified.exists(storage);
    console.log("db already exists", exists);

    if (exists) {
      console.log(await verifyDatabase(storage));
    }

    exports.sequelize = new Sequelize({
      logging: false,
      dialect: "sqlite",
      storage,
    });
  } catch (error) {
    console.log(error);
  }
}

exports.init = init;

function dispose() {
  if (exports.sequelize) {
    return exports.sequelize.close();
  }
}

exports.dispose = dispose;
