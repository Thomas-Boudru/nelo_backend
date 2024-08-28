const mongoose = require("mongoose");

const transactionsSchema = mongoose.Schema({
  transactionId: String,
  token: Number,
  creationDate: Date,
  products: [],
  warranties: [],
  event : { type: mongoose.Schema.Types.ObjectId, ref: "events" },
  stand: { type: mongoose.Schema.Types.ObjectId, ref: "stands" },
  user : { type: mongoose.Schema.Types.ObjectId, ref: "users" },
  saldo: { type: mongoose.Schema.Types.ObjectId, ref: "saldos"},
  operator: { type: mongoose.Schema.Types.ObjectId, ref: "users" },
  split: String,
  type: String,
  nameStand : String,
  code: String,

});

const Transaction = mongoose.model("transactions", transactionsSchema);

module.exports = Transaction;