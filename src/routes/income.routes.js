const express = require("express");
const incomeController = require("../controllers/income.controller");

const router = express.Router();

router.get("/other", incomeController.getOtherIncome);
router.get("/interest", incomeController.getInterestIncome);

module.exports = router;
