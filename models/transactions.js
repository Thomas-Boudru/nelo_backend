const mongoose = require("mongoose");

const transactionsSchema = mongoose.Schema({
  token: Number,
  creationDate: Date,
  products: [],
  event : { type: mongoose.Schema.Types.ObjectId, ref: "events" },
  stand: { type: mongoose.Schema.Types.ObjectId, ref: "stands" },
  user : { type: mongoose.Schema.Types.ObjectId, ref: "users" },
  saldo: { type: mongoose.Schema.Types.ObjectId, ref: "saldos"}
});

const Transaction = mongoose.model("transactions", transactionsSchema);

module.exports = Transaction;