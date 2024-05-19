var express = require('express');
var router = express.Router();
const Event = require("../models/events");
const Organizer = require("../models/organizers")
const User = require("../models/users")
const Transaction = require("../models/transactions")
const Saldo = require("../models/saldos")
const Transfer = require("../models/transfers")
const Deposit = require("../models/deposits")
const Reimburse = require("../models/reimburses")
const fetch = require('node-fetch');

const Checker = require("../models/checkers")

const limiter = require('../limiter')

// create Payment 

router.post('/paynl-transaction',limiter, async (req, res) => {
  try {
    const user = await User.findOne({ token: req.body.tokenUser });
    let lng = req.body.language
    let newDeposit;
    let saldoInput = req.body.saldoId; // Assurez-vous de récupérer la valeur correctement

    if (saldoInput) {
      newDeposit = new Deposit({
        amount: req.body.amount,
        token: req.body.tokenNumber,
        creationDate: new Date(),
        idPayment: "",
        user: user._id,
        isPaid: false,
        saldo: saldoInput,
        coin : req.body.idCoin
      });
    } else {
      res.status(500).json({ message: 'Erreur pas de saldoId' });
    }

  
      let authorizationCode = 'SL-5893-9892'
      const dataOrganizer = await Organizer.findOne({ saldoOrganizer: req.body.idCoin });
  
      if (dataOrganizer) {
        authorizationCode = dataOrganizer.authorization;
      }

    let languageBankDisplay = 'EN'

    if(lng){
      languageBankDisplay = lng.toUpperCase()
    }

    const amountToPut = req.body.amount*100

    // Attendre l'enregistrement du dépôt
    const savedDeposit = await newDeposit.save();

    const url = 'https://rest.pay.nl/v2/transactions';
    const options = {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        authorization: `Basic QVQtMDA5MC00MDY4OjE2NWVkZDA3MjZlOGNkYTUyZWI0MjVjNWU3ZGM3NmI1YTIyY2E2Yjg=`
      },
      body: JSON.stringify({
        customer: {language: `${languageBankDisplay}`},
        stats: {object: 'Coinpack'},
        serviceId: `${authorizationCode}`,
        amount: { value: amountToPut, currency: 'EUR' },
        integration: { testMode: false },
        description: `CoinPack - ${req.body.saldoName}`,
        reference: `${savedDeposit._id}`,
        returnUrl: `https://coinpack.app/statusPayment?id=${savedDeposit._id}&lng=${lng}`,
        exchangeUrl: `https://backend-coinpack-app.vercel.app/finances/paynl-status/${savedDeposit._id}`
      })
    };

    const response = await fetch(url, options);
    const data = await response.json();


    if(data.orderId) {
      await Deposit.findByIdAndUpdate(savedDeposit._id, { idPayment: data.orderId });
    }

    res.json(data);
  } catch (error) {
    console.error('Erreur:', error);
    res.status(500).json({ message: 'Erreur lors du paiement' });
  }
});





// get status

router.get('/paynl-status/:idDeposit', async (req, res) => {
  try {
    const { idDeposit} = req.params;
    const depositFound = await Deposit.findById(idDeposit);

    if (!depositFound) {
      return res.status(404).json({ message: 'Dépôt non trouvé' });
    }

    const url = `https://rest.pay.nl/v2/transactions/${depositFound.idPayment}/status`;
    const options = {
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: `Basic QVQtMDA5MC00MDY4OjE2NWVkZDA3MjZlOGNkYTUyZWI0MjVjNWU3ZGM3NmI1YTIyY2E2Yjg=`
      }
    };

    const response = await fetch(url, options);
    
    const data = await response.json();

    if (data.status.code === 100) {
      depositFound.isPaid = true;
      await depositFound.save();
     
        // Effectuer des mises à jour spécifiques pour le dépôt ayant un "saldo"
        const saldoInfoId = depositFound.saldo._id;
        const user = await User.findById(depositFound.user);
        const saldoOtherData = user.saldoOthersData.find(s => s._id.toString() === saldoInfoId.toString());


        if (saldoOtherData) {
          // Mettre à jour un solde "saldoOtherData" existant
          await User.findOneAndUpdate(
            { _id: user._id, 'saldoOthersData._id': saldoInfoId },
            {
              $push: { 'saldoOthersData.$.deposit': depositFound._id },
              $inc: { 'saldoOthersData.$.amount': depositFound.token  }
            }
          );
        } else {
          return res.status(404).json({ message: 'Informations de solde manquantes' });
        }
      
    }

    res.status(200).json(true);
  } catch (error) {
    console.error('Erreur:', error);
    res.status(500).json({ message: 'Erreur lors de la récupération du statut du paiement' });
  }
});

  
// Create Transaction Out


router.post("/createTransactionOut", async (req, res) => {
  let savedTransaction; // Declare the variable outside the try block.

  try {
    const userIdentity = req.body.userToken;
    const eventId = req.body.eventId;
    const saldoInfoId = req.body.saldoId;
    const numberToken = req.body.numberToken;
    const priceToken = req.body.priceToken;
    const standId = req.body.standId;
    const productsdata = req.body.products 
    const warrantiesdata = req.body.warranties
    const codeData = req.body.enteredCode
    let nameStand = ""
    if(req.body.standName){
      nameStand = req.body.standName
    }

    

    const user = await User.findOne({token : userIdentity});

    if (!user) {
      return res.json({ result: false, message: "User not found" });
    }

    const saldoOtherData = user.saldoOthersData.find(
      (s) => s.saldoInfo.toString() === saldoInfoId && s.isActive === true
    );

      if (!saldoOtherData) {
        return res.json({ result: false, message: "No money deposit on this saldo" });
      }

      if (saldoOtherData.amount < numberToken) {
        return res.json({ result: false, message: "Insufficient funds" });
      }

      saldoOtherData.amount -= numberToken;

      const newTransaction = new Transaction({
        token: numberToken,
        creationDate: new Date(),
        event: eventId,
        stand:standId,
        products: productsdata,
        warranties : warrantiesdata,
        user: user._id,
        saldo: saldoInfoId,
        nameStand : nameStand,
        code : codeData
      });
      savedTransaction = await newTransaction.save();

      await User.findOneAndUpdate(
        { 
          _id: user._id, 
          "saldoOthersData._id": saldoOtherData._id,
        },
        {
          $push: { 'saldoOthersData.$.transactions': savedTransaction._id },
          $set: { 'saldoOthersData.$.amount': saldoOtherData.amount }
        }
      )

      await notifyCheckers(savedTransaction);

    res.json({ result: true, message: "Transaction saved", transaction: savedTransaction });

  } catch (error) {
    console.error('Error:', error);
    res.json({ result: false, message: "Error saving transaction" });
  }
});
  

// reimburse initiation

router.post("/reimburseInitiation", async (req, res) => {
  try {
    const { userToken, saldoId } = req.body;

    if (!userToken || !saldoId) {
      return res.status(400).json({ result: false, error : "Missing", message: "Missing required data" });
    }

    const user = await User.findOne({ token: userToken });

    if (!user) {
      return res.status(404).json({ result: false, error: "Missing", message: "User not found" });
    }

    const existingReimburse = await Reimburse.findOne({ user: user._id, saldo: saldoId });

    if (existingReimburse) {
      return res.status(400).json({ result: false, error: "Already exists", message: "A reimbursement already exists for this user and saldo" });
    }

    const newReimburse = new Reimburse({
      dateCreation: new Date(),
      dateAsked: null, 
      isAsked: false,
      isDone: false,
      accountNumber: '', 
      numberToken: 0, 
      amount: 0, 
      user: user._id,
      saldo: saldoId,
    });

    await newReimburse.save();

    res.json({ result: true, message: "Reimburse created", data: newReimburse });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ result: false, message: "Error creating reimburse" });
  }
});



// route with push 


const sendPushNotification = async (token, coin, stand, event ) => {
  console.log("token",token)
  const message = {
    to: token,
    sound: 'default',
    title: `${event}`,
    body: `${coin} coins for ${stand}`,
    data: { data: "goes here" },
  };

  await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(message),
  });
}



async function notifyCheckers(transaction) {
  try {
    const eventDetails = await Event.findById(transaction.event);
    const transactionStandId = transaction.stand.toString();

    const stand = eventDetails.standsData.find(s => s._id.toString() === transactionStandId);
  
    if (stand && stand.codeExtra) {
      const codeObject = stand.codeExtra.find(codeExtra => codeExtra.code.map(String).join('') === transaction.code);


      if (codeObject) {
        const checkerIds = codeObject.users;
        const checkers = await Checker.find({ '_id': { $in: checkerIds.map(id => id.toString()) } });
        for (const checker of checkers) {
          if (checker.pushToken) {
            await sendPushNotification(checker.pushToken, transaction.token, transaction.nameStand, eventDetails.nameEvent).catch(err => console.error("Error sending notification to checker", checker._id, err));
          }
        }
      }
    }
  } catch (error) {
    console.error("Failed to send notification", error);
    throw error;
  }
}


  module.exports = router;