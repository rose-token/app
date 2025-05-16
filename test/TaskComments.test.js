const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Task Comments", function () {
  let roseMarketplace;
  let roseToken;
  let owner;
  let customer;
  let worker;
  let stakeholder;
  let daoTreasury;

  const taskDescription = "Build a website";
  const taskDeposit = ethers.parseEther("1");
  const ipfsCid = "QmT5NvUtoM5nWFfrQdVrFtvGfKFmG7AHE8P34isapyhCxX";
  const ipfsCid2 = "QmT5NvUtoM5nWFfrQdVrFtvGfKFmG7AHE8P34isapyhCxY";

  beforeEach(async function () {
    [owner, customer, worker, stakeholder, daoTreasury] = await ethers.getSigners();

    const RoseMarketplace = await ethers.getContractFactory("RoseMarketplace");
    roseMarketplace = await RoseMarketplace.deploy(daoTreasury.address);
    await roseMarketplace.waitForDeployment();

    const roseTokenAddress = await roseMarketplace.roseToken();
    roseToken = await ethers.getContractAt("RoseToken", roseTokenAddress);

    await roseMarketplace.connect(customer).claimFaucetTokens(taskDeposit * 10n);
    await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);
    await roseMarketplace.connect(customer).createTask(taskDescription, taskDeposit);
  });

  describe("Adding comments", function() {
    it("Should allow adding a top-level comment to a task", async function() {
      await expect(roseMarketplace.connect(customer).addComment(1, ipfsCid, 0))
        .to.emit(roseMarketplace, "CommentAdded")
        .withArgs(1, 1, customer.address, 0);

      const comments = await roseMarketplace.getTaskComments(1);
      expect(comments.length).to.equal(1);
      expect(comments[0].author).to.equal(customer.address);
      expect(comments[0].ipfsCid).to.equal(ipfsCid);
      expect(comments[0].parentCommentId).to.equal(0);
    });

    it("Should allow adding a reply to an existing comment", async function() {
      await roseMarketplace.connect(customer).addComment(1, ipfsCid, 0);
      
      await expect(roseMarketplace.connect(worker).addComment(1, ipfsCid2, 1))
        .to.emit(roseMarketplace, "CommentAdded")
        .withArgs(1, 2, worker.address, 1);

      const comments = await roseMarketplace.getTaskComments(1);
      expect(comments.length).to.equal(2);
      expect(comments[1].author).to.equal(worker.address);
      expect(comments[1].ipfsCid).to.equal(ipfsCid2);
      expect(comments[1].parentCommentId).to.equal(1);
    });

    it("Should revert when trying to add a comment to non-existent task", async function() {
      await expect(
        roseMarketplace.connect(customer).addComment(99, ipfsCid, 0)
      ).to.be.revertedWith("Task does not exist");
    });

    it("Should revert when trying to reply to non-existent parent comment", async function() {
      await expect(
        roseMarketplace.connect(customer).addComment(1, ipfsCid, 5)
      ).to.be.revertedWith("Parent comment does not exist");
    });

    it("Should store the correct content hash", async function() {
      await roseMarketplace.connect(customer).addComment(1, ipfsCid, 0);
      
      const comments = await roseMarketplace.getTaskComments(1);
      const expectedHash = ethers.keccak256(ethers.toUtf8Bytes(ipfsCid));
      expect(comments[0].contentHash).to.equal(expectedHash);
    });

    it("Should increment task comment count correctly", async function() {
      await roseMarketplace.connect(customer).addComment(1, ipfsCid, 0);
      expect(await roseMarketplace.taskCommentCount(1)).to.equal(1);

      await roseMarketplace.connect(worker).addComment(1, ipfsCid2, 1);
      expect(await roseMarketplace.taskCommentCount(1)).to.equal(2);
    });
  });

  describe("Retrieving comments", function() {
    beforeEach(async function() {
      await roseMarketplace.connect(customer).addComment(1, ipfsCid, 0);
      await roseMarketplace.connect(worker).addComment(1, ipfsCid2, 1);
    });

    it("Should return all comments for a task", async function() {
      const comments = await roseMarketplace.getTaskComments(1);
      expect(comments.length).to.equal(2);
      expect(comments[0].author).to.equal(customer.address);
      expect(comments[0].ipfsCid).to.equal(ipfsCid);
      expect(comments[1].author).to.equal(worker.address);
      expect(comments[1].ipfsCid).to.equal(ipfsCid2);
    });

    it("Should revert when trying to get comments for non-existent task", async function() {
      await expect(
        roseMarketplace.getTaskComments(99)
      ).to.be.revertedWith("Task does not exist");
    });
  });
});
