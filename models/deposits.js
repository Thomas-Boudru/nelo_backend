const mongoose = require("mongoose");

const depositsSchema = mongoose.Schema({
  amount: Number,
  token: Number,
  creationDate: Date,
  idPayment : String,
  isPaid: Boolean,
  method: String,
  operator: { type: mongoose.Schema.Types.ObjectId, ref: "users" },
  user : { type: mongoose.Schema.Types.ObjectId, ref: "users" },
  saldo: { type: mongoose.Schema.Types.ObjectId, ref: "saldos"},
  coin: { type: mongoose.Schema.Types.ObjectId, ref: "saldos"}
});

const Deposit = mongoose.model("deposits", depositsSchema);

module.exports = Deposit;