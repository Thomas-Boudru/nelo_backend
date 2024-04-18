const mongoose = require("mongoose");

const statusSchema = mongoose.Schema({
  maintenance: Boolean,
  version: String,
});

const Status = mongoose.model("status", statusSchema);

module.exports = Status;