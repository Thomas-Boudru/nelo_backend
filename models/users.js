const mongoose = require("mongoose");

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
});

const User = mongoose.model("users", usersSchema);

module.exports = User;