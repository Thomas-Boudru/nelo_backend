const mongoose = require("mongoose");

const saldoMain = mongoose.Schema({
  amount: Number,
  transactions : [{ type: mongoose.Schema.Types.ObjectId, ref: "transactions" }],
  transfers : [{ type: mongoose.Schema.Types.ObjectId, ref: "transfers" }],
})

const saldoOthers = mongoose.Schema({
  amount: Number,
  saldoInfo : { type: mongoose.Schema.Types.ObjectId, ref: "saldos" },
  transactions : [{ type: mongoose.Schema.Types.ObjectId, ref: "transactions" }],
  transfers : [{ type: mongoose.Schema.Types.ObjectId, ref: "transfers" }],
})


const userData = mongoose.Schema({
  firstname :  String,
  name: String,
  picture : String
})


const usersSchema = mongoose.Schema({
  token: String,
  email: String,
  password: String,
  language : String,
  isActive: Boolean,
  isConditions: Boolean,
  isMailing : Boolean,
  dateCreation: Date,
  userData : userData,

  saldoMainData: saldoMain,
  saldoOthersData : [saldoOthers]
});

const User = mongoose.model("users", usersSchema);

module.exports = User;