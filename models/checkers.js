const mongoose = require("mongoose");

const standData = mongoose.Schema({
    standId :  String,
    code : String,
    transactions: [{ type: mongoose.Schema.Types.ObjectId, ref: "transactions" }]
  })

const userData = mongoose.Schema({
    firstname :  String,
    name : String,
    picture : String
  })

const event = mongoose.Schema({
    event : { type: mongoose.Schema.Types.ObjectId, ref: "events" },
    stand : [standData]
})

const checkersSchema = mongoose.Schema({
    token: String,
    email: String,
    password: String,
    language : String,
    isActive: Boolean,
    dateCreation: Date,
    pushToken: String,
    actionPlace : [event],
    userData : [userData],
});

const Checker = mongoose.model("checkers", checkersSchema);

module.exports = Checker;