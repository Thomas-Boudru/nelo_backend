const mongoose = require("mongoose");

const depositsSchema = mongoose.Schema({
  amount: Number,
  creationDate: Date,
  idPayment : String,
  isPaid: Boolean,
  user : { type: mongoose.Schema.Types.ObjectId, ref: "users" },
  saldo: { type: mongoose.Schema.Types.ObjectId, ref: "saldos"}
});

const Deposit = mongoose.model("deposits", depositsSchema);

module.exports = Deposit;