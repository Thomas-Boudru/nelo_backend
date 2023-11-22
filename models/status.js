const mongoose = require("mongoose");

const statusSchema = mongoose.Schema({
  maintenancce: Boolean
});

const Status = mongoose.model("deposits", statusSchema);

module.exports = Status;