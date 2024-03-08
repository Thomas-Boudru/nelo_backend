const mongoose = require("mongoose");

const saldoOthers = mongoose.Schema({
  amount: Number,
  saldoInfo : { type: mongoose.Schema.Types.ObjectId, ref: "saldos" },
  transactions : [{ type: mongoose.Schema.Types.ObjectId, ref: "transactions" }],
  deposit: [{ type: mongoose.Schema.Types.ObjectId, ref: "deposits" }],
  isActive: Boolean,
})


const userData = mongoose.Schema({
  pseudo :  String,
  name : String,
  picture : String
})


const usersSchema = mongoose.Schema({
  token: String,
  email: String,
  password: String,
  language : String,
  isOpen : Boolean,
  isActive: Boolean,
  isConditions: Boolean,
  isMailing : Boolean,
  dateCreation: Date,
  userData : userData,

  events : [{ type: mongoose.Schema.Types.ObjectId, ref: "events" }],
  
  saldoOthersData : [saldoOthers]
});

const User = mongoose.model("users", usersSchema);

module.exports = User;