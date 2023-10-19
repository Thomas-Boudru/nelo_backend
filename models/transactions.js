const mongoose = require("mongoose");

const transactionsSchema = mongoose.Schema({
  amount: Number,
  token: Number,
  creationDate: Date,
  user : { type: mongoose.Schema.Types.ObjectId, ref: "users" },
  saldo: { type: mongoose.Schema.Types.ObjectId, ref: "saldos" }
});

const Transaction = mongoose.model("transactions", transactionsSchema);

module.exports = Transaction;