const mongoose = require("mongoose");

const transfersSchema = mongoose.Schema({
  amount: Number,
  token : Number,
  creationDate: Date,
  sender : { type: mongoose.Schema.Types.ObjectId, ref: "users" },
  receiver : { type: mongoose.Schema.Types.ObjectId, ref: "users" },
  saldo: { type: mongoose.Schema.Types.ObjectId, ref: "saldos" },
});

const Transfer = mongoose.model("transfers", transfersSchema);

module.exports = Transfer;