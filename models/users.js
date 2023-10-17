const mongoose = require("mongoose");

const saldo = mongoose.Schema({
  amount: String,
  event : [{ type: mongoose.Schema.Types.ObjectId, ref: "events" }],
  organizer : [{ type: mongoose.Schema.Types.ObjectId, ref: "organizers" }],
  creationDate: Date,
  endDate: Date,
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
  saldoData : [saldo]
});

const User = mongoose.model("users", usersSchema);

module.exports = User;