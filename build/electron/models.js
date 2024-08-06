const db = require("./db");
const Sequelize = require("sequelize");

const userVisitedSiteColumns = {
  icon: Sequelize.BLOB,
  screenshot: { type: Sequelize.BLOB },
  iconWidth: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
  iconHeight: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
  screenshotWidth: {
    type: Sequelize.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  screenshotHeight: {
    type: Sequelize.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  filePath: Sequelize.STRING(500),
  url: Sequelize.STRING(300),
  idleSeconds: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
  time: { type: Sequelize.DATE, primaryKey: true },
  userId: { type: Sequelize.STRING(200), allowNull: false },
  organisationId: { type: Sequelize.STRING(40), allowNull: false },
  teamId: Sequelize.STRING(40),
  projectId: Sequelize.STRING(40),
  taskId: Sequelize.STRING(40),
};

const userVisitedSites = db.sequelize.define(
  "user_visited_site",
  userVisitedSiteColumns
);

exports.userVisitedSites = userVisitedSites;
exports.userVisitedSiteColumns = userVisitedSiteColumns;
