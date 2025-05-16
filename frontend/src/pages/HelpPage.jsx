import React, { useState } from 'react';

const HelpPage = () => {
  const [expandedSections, setExpandedSections] = useState({
    introduction: true,
    roles: false,
    tasks: false,
    whitepaper: false,
    faq: false,
    troubleshooting: false,
    glossary: false
  });

  const toggleSection = (section) => {
    setExpandedSections({
      ...expandedSections,
      [section]: !expandedSections[section]
    });
  };

  const CollapsibleSection = ({ id, title, children }) => (
    <div className="mb-6 border rounded-lg overflow-hidden">
      <button 
        onClick={() => toggleSection(id)}
        className="w-full p-4 text-left font-bold bg-primary text-primary-foreground flex justify-between items-center"
      >
        {title}
        <span>{expandedSections[id] ? '−' : '+'}</span>
      </button>
      {expandedSections[id] && (
        <div className="p-4 bg-white">
          {children}
        </div>
      )}
    </div>
  );

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <h1 className="text-3xl font-bold mb-8">Rose Token Help Center</h1>
        
      <p className="mb-8 text-lg">
        Welcome to the Rose Token help center. Here you'll find comprehensive guides 
        and documentation to help you understand and use our platform effectively.
      </p>
        
      <CollapsibleSection id="introduction" title="Introduction to Rose Token">
        <div className="space-y-4">
          <h3 className="text-xl font-semibold">What is Rose Token?</h3>
          <p>
            Rose Token is a decentralized marketplace with a socialist token distribution model,
            built on Ethereum using Solidity. Our platform reimagines how value is distributed in 
            digital economies, ensuring fair compensation for all contributors.
          </p>
            
          <h3 className="text-xl font-semibold">Core Principles</h3>
          <ul className="list-disc pl-5 space-y-2">
            <li>
              <strong>Fair Distribution:</strong> Value is distributed among all contributors, not just owners
            </li>
            <li>
              <strong>Transparent Operations:</strong> All marketplace activities and token distributions are recorded on the blockchain
            </li>
            <li>
              <strong>Community Governance:</strong> A portion of all tokens goes to a DAO treasury for community-driven decisions
            </li>
            <li>
              <strong>Worker Empowerment:</strong> The majority of value goes to those who perform the actual work
            </li>
          </ul>
        </div>
      </CollapsibleSection>
        
      <CollapsibleSection id="roles" title="Understanding User Roles">
        <div className="space-y-4">
          <p>
            Rose Token's ecosystem consists of three primary roles, each with unique responsibilities and benefits:
          </p>
            
          <h3 className="text-xl font-semibold">Customers</h3>
          <div className="pl-4 border-l-4 border-primary p-4 mb-4">
            <p><strong>Who they are:</strong> Individuals or organizations that need tasks completed.</p>
            <p><strong>What they do:</strong></p>
            <ul className="list-disc pl-5">
              <li>Create tasks with clear descriptions and requirements</li>
              <li>Deposit ETH as payment for task completion</li>
              <li>Review completed work and provide feedback</li>
              <li>Participate in dispute resolution if necessary</li>
            </ul>
            <p><strong>Benefits:</strong> Get tasks completed by qualified workers in a transparent system.</p>
          </div>
            
          <h3 className="text-xl font-semibold">Workers</h3>
          <div className="pl-4 border-l-4 border-primary p-4 mb-4">
            <p><strong>Who they are:</strong> Individuals who complete tasks for compensation.</p>
            <p><strong>What they do:</strong></p>
            <ul className="list-disc pl-5">
              <li>Browse available tasks and claim those matching their skills</li>
              <li>Complete tasks according to requirements</li>
              <li>Submit work for review</li>
              <li>Participate in dispute resolution if necessary</li>
            </ul>
            <p><strong>Benefits:</strong> Receive 60% of the new ROSE tokens minted for each completed task.</p>
          </div>
            
          <h3 className="text-xl font-semibold">Stakeholders</h3>
          <div className="pl-4 border-l-4 border-primary p-4">
            <p><strong>Who they are:</strong> Individuals who help validate work and resolve disputes.</p>
            <p><strong>What they do:</strong></p>
            <ul className="list-disc pl-5">
              <li>Review completed tasks to ensure quality</li>
              <li>Validate work as meeting requirements</li>
              <li>Arbitrate disputes between customers and workers</li>
              <li>Help maintain the integrity of the marketplace</li>
            </ul>
            <p><strong>Benefits:</strong> Receive 20% of the new ROSE tokens minted for each validated task.</p>
          </div>
        </div>
      </CollapsibleSection>
        
      <CollapsibleSection id="tasks" title="Step-by-Step Task Guides">
        <div className="space-y-6">
          <div className="mb-6">
            <h3 className="text-xl font-semibold mb-3">For Customers: Creating a Task</h3>
            <ol className="list-decimal pl-5 space-y-4">
              <li>
                <p><strong>Connect Your Wallet</strong></p>
                <p>Click the "Connect Wallet" button in the top-right corner and follow the prompts to connect your MetaMask wallet.</p>
                <p className="text-sm text-gray-600 mt-1">
                  Ensure you're on the Sepolia testnet. If you're not, the network selector will allow you to switch.
                </p>
              </li>
              <li>
                <p><strong>Navigate to the Marketplace</strong></p>
                <p>Click on "Marketplace" in the navigation menu to go to the main tasks page.</p>
              </li>
              <li>
                <p><strong>Create a New Task</strong></p>
                <p>Click the "Create Task" button and fill out the form with the following information:</p>
                <ul className="list-disc pl-5 mt-2">
                  <li><strong>Task Title:</strong> A clear, concise title</li>
                  <li><strong>Description:</strong> Detailed explanation of what needs to be done</li>
                  <li><strong>Deposit Amount:</strong> The amount of ETH you're willing to pay</li>
                  <li><strong>Deadline:</strong> When the task should be completed by</li>
                </ul>
              </li>
              <li>
                <p><strong>Submit and Confirm</strong></p>
                <p>Click "Submit" and confirm the transaction in MetaMask. Your ETH will be deposited into the marketplace contract.</p>
              </li>
              <li>
                <p><strong>Monitor and Respond</strong></p>
                <p>Track your task on the marketplace. When a worker submits completed work, you'll need to review it and either approve or dispute it.</p>
              </li>
            </ol>
          </div>
            
          <div className="mb-6">
            <h3 className="text-xl font-semibold mb-3">For Workers: Completing Tasks</h3>
            <ol className="list-decimal pl-5 space-y-4">
              <li>
                <p><strong>Connect Your Wallet</strong></p>
                <p>Click the "Connect Wallet" button and connect your MetaMask wallet.</p>
              </li>
              <li>
                <p><strong>Browse Available Tasks</strong></p>
                <p>On the Marketplace page, browse through available tasks that haven't been claimed yet.</p>
              </li>
              <li>
                <p><strong>Claim a Task</strong></p>
                <p>When you find a task you want to work on, click "Claim Task" and confirm the transaction.</p>
                <p className="text-sm text-gray-600 mt-1">
                  Once claimed, the task will be reserved for you until the deadline.
                </p>
              </li>
              <li>
                <p><strong>Complete the Work</strong></p>
                <p>Perform the work as specified in the task description.</p>
              </li>
              <li>
                <p><strong>Submit Completed Work</strong></p>
                <p>Return to the task page, click "Submit Work," and provide details about your completed work.</p>
                <p>Include any relevant links, documentation, or evidence that the work is complete.</p>
              </li>
              <li>
                <p><strong>Await Validation</strong></p>
                <p>Wait for the customer or a stakeholder to validate your work.</p>
                <p>If approved, you'll receive 60% of the ROSE tokens minted for this task.</p>
              </li>
            </ol>
          </div>
            
          <div>
            <h3 className="text-xl font-semibold mb-3">For Stakeholders: Validating Work</h3>
            <ol className="list-decimal pl-5 space-y-4">
              <li>
                <p><strong>Connect Your Wallet</strong></p>
                <p>Connect your MetaMask wallet to the platform.</p>
              </li>
              <li>
                <p><strong>Access the Validation Queue</strong></p>
                <p>Navigate to the "Validations" section where tasks requiring review are listed.</p>
              </li>
              <li>
                <p><strong>Review Task Submissions</strong></p>
                <p>Click on a task to review the original requirements and the work submitted by the worker.</p>
              </li>
              <li>
                <p><strong>Make a Decision</strong></p>
                <p>After thorough review, click either "Approve" or "Dispute" based on your assessment.</p>
                <p>Provide a detailed explanation for your decision, especially in case of disputes.</p>
              </li>
              <li>
                <p><strong>Confirm Transaction</strong></p>
                <p>Confirm your decision through MetaMask.</p>
                <p>If you approve the work, you'll receive 20% of the ROSE tokens minted for this task.</p>
              </li>
            </ol>
          </div>
        </div>
      </CollapsibleSection>
        
      <CollapsibleSection id="whitepaper" title="White Paper: The Socialist Token Model">
        <div className="space-y-6">
          <h3 className="text-xl font-semibold">Executive Summary</h3>
          <p>
            The Rose Token implements a new paradigm in cryptocurrency: a socialist token distribution model that prioritizes 
            labor value over capital ownership. This white paper outlines our economic philosophy, technical implementation, 
            and vision for creating a more equitable digital economy.
          </p>
            
          <h3 className="text-xl font-semibold">The Problem with Traditional Token Models</h3>
          <p>
            Traditional cryptocurrency models often replicate the inequalities of existing financial systems:
          </p>
          <ul className="list-disc pl-5 mt-2 space-y-2">
            <li>Early investors and founders receive disproportionate token allocations</li>
            <li>Value accrues primarily to capital providers rather than labor contributors</li>
            <li>Token economies often lead to extreme wealth concentration</li>
            <li>Governance power accumulates with the wealthy, creating plutocratic systems</li>
          </ul>
            
          <h3 className="text-xl font-semibold">Our Economic Philosophy</h3>
          <p>
            The Rose Token is built on these core economic principles:
          </p>
          <ul className="list-disc pl-5 mt-2 space-y-2">
            <li><strong>Labor Theory of Value:</strong> Value comes from work performed, not capital invested</li>
            <li><strong>Democratic Governance:</strong> Decision-making power should be distributed broadly</li>
            <li><strong>Collective Prosperity:</strong> Economic systems should benefit the many, not the few</li>
            <li><strong>Transparency and Accountability:</strong> All economic activities should be visible and verifiable</li>
          </ul>
            
          <h3 className="text-xl font-semibold">Technical Implementation</h3>
          <p>
            Our implementation consists of two main smart contracts:
          </p>
          <ul className="list-disc pl-5 mt-2 space-y-2">
            <li><strong>RoseToken (ERC20):</strong> A standard ERC20 token with controlled minting permissions</li>
            <li><strong>RoseMarketplace:</strong> A decentralized task marketplace that manages the token distribution system</li>
          </ul>
          <p className="mt-4">
            The token distribution follows this model for each completed and validated task:
          </p>
          <div className="my-4 p-4 bg-gray-100 rounded-md">
            <ul className="list-none space-y-2">
              <li>🔹 <strong>60%</strong> to the Worker who completed the task</li>
              <li>🔹 <strong>20%</strong> to the Stakeholder who validated the work</li>
              <li>🔹 <strong>20%</strong> to the DAO Treasury for community governance</li>
            </ul>
          </div>
            
          <h3 className="text-xl font-semibold">Long-term Vision</h3>
          <p>
            We envision Rose Token evolving into a complete ecosystem for equitable digital labor:
          </p>
          <ul className="list-disc pl-5 mt-2 space-y-2">
            <li>A full DAO governance system where all token holders can participate in decision-making</li>
            <li>Integration with other DeFi protocols while maintaining socialist distribution principles</li>
            <li>Development of specialized marketplaces for different types of work</li>
            <li>Implementation of reputation systems that reward consistent quality work</li>
            <li>Creation of educational resources to promote understanding of socialist economic principles</li>
          </ul>
            
          <h3 className="text-xl font-semibold">Conclusion</h3>
          <p>
            The Rose Token represents a fundamentally different approach to cryptocurrency economies - one that values 
            human contribution over capital, cooperation over competition, and equitable distribution over concentration 
            of wealth. By aligning economic incentives with socialist principles, we aim to demonstrate that blockchain 
            technology can be used to create more just and equitable economic systems.
          </p>
        </div>
      </CollapsibleSection>
        
      <CollapsibleSection id="faq" title="Frequently Asked Questions">
        <div className="space-y-4">
          {[
            {
              q: "How do I earn ROSE tokens?",
              a: "You can earn ROSE tokens in two primary ways: by completing tasks as a Worker (earning 60% of minted tokens) or by validating work as a Stakeholder (earning 20% of minted tokens)."
            },
            {
              q: "What can I do with ROSE tokens?",
              a: "ROSE tokens can be used for governance voting (once DAO features are implemented), can be held as a store of value, or can be traded on supported exchanges (when available)."
            },
            {
              q: "How is the value of tasks determined?",
              a: "Task values are set by customers when they create tasks. The ETH deposit they provide indicates the value they place on the completion of the task."
            },
            {
              q: "What happens if my work is disputed?",
              a: "If your work is disputed, a stakeholder will review the dispute and make a determination. If the dispute is resolved in your favor, you'll receive your tokens. If not, the task may be reopened or the deposit returned to the customer."
            },
            {
              q: "How do I become a stakeholder?",
              a: "Currently, stakeholder roles are assigned through the governance system. In the future, we plan to implement a qualification mechanism based on work history and token holdings."
            },
            {
              q: "Is Rose Token available on mainnet?",
              a: "Currently, Rose Token operates on the Sepolia testnet. Mainnet deployment is planned for the future once thorough testing and auditing are complete."
            },
            {
              q: "What fees are associated with using the platform?",
              a: "The platform itself doesn't charge fees beyond standard Ethereum gas fees for transactions. All value transfers in the system are transparent and follow our socialist distribution model."
            }
          ].map((item, index) => (
            <div key={index} className="border-b pb-4">
              <h4 className="font-bold text-lg mb-2">{item.q}</h4>
              <p>{item.a}</p>
            </div>
          ))}
        </div>
      </CollapsibleSection>
        
      <CollapsibleSection id="troubleshooting" title="Troubleshooting Common Issues">
        <div className="space-y-6">
          <div className="mb-4">
            <h3 className="text-xl font-semibold mb-3">Wallet Connection Issues</h3>
            <div className="space-y-4">
              <div className="p-4 bg-gray-100 rounded-md">
                <h4 className="font-bold">Problem: MetaMask not connecting</h4>
                <p className="mt-2">Try these steps:</p>
                <ol className="list-decimal pl-5 mt-2">
                  <li>Ensure MetaMask is installed and unlocked</li>
                  <li>Refresh the page and try connecting again</li>
                  <li>Check if you're on the correct network (Sepolia)</li>
                  <li>Clear browser cache and cookies</li>
                  <li>Try using a different browser</li>
                </ol>
              </div>
                
              <div className="p-4 bg-gray-100 rounded-md">
                <h4 className="font-bold">Problem: Wrong network showing</h4>
                <p className="mt-2">Our platform requires the Sepolia testnet. To switch networks:</p>
                <ol className="list-decimal pl-5 mt-2">
                  <li>Click the network dropdown in MetaMask</li>
                  <li>Select "Sepolia Test Network"</li>
                  <li>If not visible, go to MetaMask Settings {'->'} Networks {'->'} Add Network</li>
                  <li>Add Sepolia with RPC URL: https://sepolia.infura.io/v3/YOUR_INFURA_KEY</li>
                  <li>Chain ID: 11155111</li>
                </ol>
              </div>
            </div>
          </div>
            
          <div className="mb-4">
            <h3 className="text-xl font-semibold mb-3">Transaction Issues</h3>
            <div className="space-y-4">
              <div className="p-4 bg-gray-100 rounded-md">
                <h4 className="font-bold">Problem: Transaction pending for too long</h4>
                <ol className="list-decimal pl-5 mt-2">
                  <li>Check Sepolia gas prices and ensure you've set an appropriate gas fee</li>
                  <li>In MetaMask, you can speed up the transaction by clicking on the pending transaction and selecting "Speed Up"</li>
                  <li>Alternatively, you can cancel the transaction and try again</li>
                </ol>
              </div>
                
              <div className="p-4 bg-gray-100 rounded-md">
                <h4 className="font-bold">Problem: Transaction failed</h4>
                <p className="mt-2">Common reasons for failure:</p>
                <ul className="list-disc pl-5 mt-2">
                  <li>Insufficient ETH for gas</li>
                  <li>Contract error (check the specific error message)</li>
                  <li>Network congestion</li>
                </ul>
                <p className="mt-2">Try increasing your gas limit or waiting for network conditions to improve.</p>
              </div>
            </div>
          </div>
            
          <div>
            <h3 className="text-xl font-semibold mb-3">Task-Related Issues</h3>
            <div className="space-y-4">
              <div className="p-4 bg-gray-100 rounded-md">
                <h4 className="font-bold">Problem: Can't claim a task</h4>
                <p className="mt-2">Possible reasons:</p>
                <ul className="list-disc pl-5 mt-2">
                  <li>The task has already been claimed by another worker</li>
                  <li>The task deadline has passed</li>
                  <li>You're already working on too many tasks</li>
                  <li>You don't meet task requirements (if implemented)</li>
                </ul>
              </div>
                
              <div className="p-4 bg-gray-100 rounded-md">
                <h4 className="font-bold">Problem: Submitted work not being validated</h4>
                <p className="mt-2">Validation can take time depending on stakeholder availability. If it's been more than 72 hours:</p>
                <ol className="list-decimal pl-5 mt-2">
                  <li>Check if there are any comments from stakeholders requesting additional information</li>
                  <li>Reach out on our community channels for assistance</li>
                  <li>If persistent, a dispute resolution process can be initiated</li>
                </ol>
              </div>
            </div>
          </div>
        </div>
      </CollapsibleSection>
        
      <CollapsibleSection id="glossary" title="Glossary of Terms">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {[
            {
              term: "ROSE Token",
              definition: "The native ERC20 token of the platform, distributed according to socialist principles when tasks are completed."
            },
            {
              term: "Customer",
              definition: "A user who creates tasks and provides ETH deposits for their completion."
            },
            {
              term: "Worker",
              definition: "A user who claims and completes tasks, earning 60% of minted ROSE tokens upon successful validation."
            },
            {
              term: "Stakeholder",
              definition: "A user who validates completed work and arbitrates disputes, earning 20% of minted ROSE tokens."
            },
            {
              term: "DAO Treasury",
              definition: "A community-controlled fund that receives 20% of all minted ROSE tokens for governance and future development."
            },
            {
              term: "Task",
              definition: "A unit of work created by a Customer with a specific description, deadline, and ETH deposit."
            },
            {
              term: "Validation",
              definition: "The process of reviewing and approving completed work to trigger token distribution."
            },
            {
              term: "Dispute",
              definition: "A formal disagreement between Customer and Worker regarding task completion that requires Stakeholder arbitration."
            },
            {
              term: "Mint/Minting",
              definition: "The process of creating new ROSE tokens, which occurs only when tasks are successfully completed and validated."
            },
            {
              term: "Socialist Distribution Model",
              definition: "The economic system whereby value is distributed primarily to workers (60%) rather than capital owners."
            },
            {
              term: "MetaMask",
              definition: "The primary wallet interface used to interact with the Rose Token platform."
            },
            {
              term: "Sepolia",
              definition: "The Ethereum testnet where the Rose Token platform is currently deployed."
            }
          ].map((item, index) => (
            <div key={index} className="border-b pb-4">
              <h4 className="font-bold text-lg">{item.term}</h4>
              <p>{item.definition}</p>
            </div>
          ))}
        </div>
      </CollapsibleSection>
    </div>
  );
};

export default HelpPage;
