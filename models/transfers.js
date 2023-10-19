const mongoose = require("mongoose");

const transfersSchema = mongoose.Schema({
  amount: Number,
  creationDate: Date,
  user : { type: mongoose.Schema.Types.ObjectId, ref: "users" },
  saldo: [{ type: mongoose.Schema.Types.ObjectId, ref: "saldos" }]
});

const Transfer = mongoose.model("transfers", transfersSchema);

module.exports = Transfer;