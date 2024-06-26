const mongoose = require("mongoose");

const reimbursesSchema = mongoose.Schema({
  dateCreation: Date,
  dateAsked : Date,
  dateDone : Date,
  isAsked : Boolean,
  isDone : Boolean,
  accountNumber : String,
  numberToken : Number,
  priceToken: Number, 
  commission: Number,
  amount: Number,
  user : { type: mongoose.Schema.Types.ObjectId, ref: "users" },
  saldo : { type: mongoose.Schema.Types.ObjectId, ref: "saldos" },
});

const Reimburse = mongoose.model("reimburses", reimbursesSchema);

module.exports = Reimburse;