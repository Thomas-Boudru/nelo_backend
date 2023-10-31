const mongoose = require("mongoose");

const saldosSchema = mongoose.Schema({
  name: String,
  unique: Boolean,
  picture: String,
  creationDate: Date,
  endDate: Date,
  organizer : { type: mongoose.Schema.Types.ObjectId, ref: "organizers" },
  event : { type: mongoose.Schema.Types.ObjectId, ref: "events" },
});

const Saldo = mongoose.model("saldos", saldosSchema);

module.exports = Saldo;