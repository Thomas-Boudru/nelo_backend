const mongoose = require("mongoose");

const saldosSchema = mongoose.Schema({
  name: String,
  creationDate: Date,
  endDate: Date,
  organizer : { type: mongoose.Schema.Types.ObjectId, ref: "organizers" },
});

const Saldo = mongoose.model("saldos", saldosSchema);

module.exports = Saldo;