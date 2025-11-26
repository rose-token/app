import React, { useState, useCallback } from 'react';
import { uploadCommentToIPFS, fetchCommentFromIPFS, isCID } from '../utils/ipfs/pinataService';

const HelpPage = () => {
  const [expandedSections, setExpandedSections] = useState({
    introduction: true,
    roles: false,
    tasks: false,
    whitepaper: false,
    faq: false,
    troubleshooting: false,
    glossary: false,
    bugReports: false
  });
  
  // Bug report states
  const [bugTitle, setBugTitle] = useState('');
  const [bugDescription, setBugDescription] = useState('');
  const [bugSteps, setBugSteps] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [bugError, setBugError] = useState('');
  const [bugSuccess, setBugSuccess] = useState('');
  const [submittedCid, setSubmittedCid] = useState('');
  const [bugReports, setBugReports] = useState([]);
  const [selectedReport, setSelectedReport] = useState(null);
  const [lookupCid, setLookupCid] = useState('');
  const [lookupReport, setLookupReport] = useState(null);
  const [isLoadingReport, setIsLoadingReport] = useState(false);
  const [isLookingUp, setIsLookingUp] = useState(false);

  const toggleSection = (section) => {
    setExpandedSections({
      ...expandedSections,
      [section]: !expandedSections[section]
    });
    
    // Load bug reports when bug reports section is opened
    if (section === 'bugReports' && !expandedSections.bugReports) {
      const storedBugs = JSON.parse(localStorage.getItem('submittedBugs') || '[]');
      setBugReports(storedBugs);
    }
  };

  // Bug report submission handler
  const handleBugSubmit = async (e) => {
    e.preventDefault();
    if (!bugTitle.trim() || !bugDescription.trim()) return;
    
    try {
      setIsSubmitting(true);
      setBugError('');
      setBugSuccess('');
      
      const bugData = JSON.stringify({
        title: bugTitle,
        description: bugDescription,
        steps: bugSteps,
        timestamp: new Date().toISOString(),
        type: 'bug-report'
      });
      
      const cid = await uploadCommentToIPFS(bugData);
      
      const storedBugs = JSON.parse(localStorage.getItem('submittedBugs') || '[]');
      const newBug = {
        cid,
        title: bugTitle,
        timestamp: new Date().toISOString()
      };
      storedBugs.push(newBug);
      localStorage.setItem('submittedBugs', JSON.stringify(storedBugs));
      
      // Update local state
      setBugReports([...bugReports, newBug]);
      
      setBugTitle('');
      setBugDescription('');
      setBugSteps('');
      setSubmittedCid(cid);
      setBugSuccess(`Bug report submitted successfully! CID: ${cid}`);
    } catch (err) {
      console.error('Error submitting bug report:', err);
      if (err.message.includes('Pinata')) {
        setBugError('Failed to upload bug report to IPFS. Please check Pinata API keys.');
      } else {
        setBugError('Failed to submit bug report');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Fetch report details from list
  const fetchReportDetails = useCallback(async (cid) => {
    if (!cid) return;
    
    try {
      setIsLoadingReport(true);
      setBugError('');
      
      const reportData = await fetchCommentFromIPFS(cid);
      const parsedData = typeof reportData === 'string' 
        ? JSON.parse(reportData) 
        : reportData;
      
      setSelectedReport({
        cid,
        ...parsedData
      });
    } catch (err) {
      console.error('Error fetching report details:', err);
      setBugError('Failed to fetch report details from IPFS');
    } finally {
      setIsLoadingReport(false);
    }
  }, []);

  // Look up report by CID
  const handleLookupReport = useCallback(async (e) => {
    e.preventDefault();
    if (!lookupCid.trim()) return;
    
    try {
      setIsLookingUp(true);
      setBugError('');
      setBugSuccess('');
      setLookupReport(null);
      
      if (!isCID(lookupCid)) {
        setBugError('Invalid CID format. Please enter a valid IPFS Content Identifier.');
        return;
      }
      
      const reportData = await fetchCommentFromIPFS(lookupCid);
      
      const parsedData = typeof reportData === 'string' 
        ? JSON.parse(reportData) 
        : reportData;
      
      if (parsedData.type !== 'bug-report') {
        setBugError('The content at this CID is not a bug report.');
        return;
      }
      
      setLookupReport({
        cid: lookupCid,
        ...parsedData
      });
      setBugSuccess('Bug report found!');
    } catch (err) {
      console.error('Error looking up report:', err);
      setBugError('Failed to fetch report. The CID may be invalid or the content is not available on IPFS.');
    } finally {
      setIsLookingUp(false);
    }
  }, [lookupCid]);

  const formatDate = (dateString) => {
    const options = { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    };
    return new Date(dateString).toLocaleDateString(undefined, options);
  };

  const CollapsibleSection = ({ id, title, children }) => (
    <div
      className="mb-6 rounded-[20px] overflow-hidden"
      style={{
        border: '1px solid var(--border-subtle)',
        boxShadow: 'var(--shadow-card)'
      }}
    >
      <button
        onClick={() => toggleSection(id)}
        className="w-full p-4 text-left font-bold flex justify-between items-center transition-all duration-200"
        style={{
          background: 'linear-gradient(135deg, var(--rose-pink) 0%, var(--rose-gold) 100%)',
          color: 'var(--bg-primary)'
        }}
      >
        {title}
        <span>{expandedSections[id] ? '−' : '+'}</span>
      </button>
      {expandedSections[id] && (
        <div className="p-4" style={{ background: 'var(--bg-card)' }}>
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
            Rose Token is a decentralized marketplace with a worker token distribution model,
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
            <p><strong>Benefits:</strong> Receive 95% of ROSE tokens deposited for each completed task.</p>
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
            <p><strong>Benefits:</strong> Receive 5% of ROSE tokens deposited for each validated task.</p>
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
                  Ensure you're on the Hoodi or Sepolia testnet. If you're not, the network selector will allow you to switch.
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
                <p>If approved, you'll receive 95% of the ROSE tokens deposited for this task.</p>
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
                <p>If you approve the work, you'll receive 5% of the ROSE tokens deposited for this task.</p>
              </li>
            </ol>
          </div>
        </div>
      </CollapsibleSection>
        
      <CollapsibleSection id="whitepaper" title="White Paper: The Worker Token Model">
        <div className="space-y-6">
          <h3 className="text-xl font-semibold">Executive Summary</h3>
          <p>
            The Rose Token implements a new paradigm in cryptocurrency: a worker token distribution model that prioritizes 
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
          <div className="my-4 p-4 rounded-xl" style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--border-subtle)' }}>
            <ul className="list-none space-y-2" style={{ color: 'var(--text-secondary)' }}>
              <li>🔹 <strong style={{ color: 'var(--text-primary)' }}>95%</strong> to the Worker who completed the task</li>
              <li>🔹 <strong style={{ color: 'var(--text-primary)' }}>5%</strong> to the Stakeholder who validated the work</li>
              <li>🔹 <strong style={{ color: 'var(--text-primary)' }}>2%</strong> to the DAO Treasury for community governance</li>
            </ul>
          </div>
            
          <h3 className="text-xl font-semibold">Long-term Vision</h3>
          <p>
            We envision Rose Token evolving into a complete ecosystem for equitable digital labor:
          </p>
          <ul className="list-disc pl-5 mt-2 space-y-2">
            <li>A full DAO governance system where all token holders can participate in decision-making</li>
            <li>Integration with other DeFi protocols while maintaining worker-focused distribution principles</li>
            <li>Development of specialized marketplaces for different types of work</li>
            <li>Implementation of reputation systems that reward consistent quality work</li>
            <li>Creation of educational resources to promote understanding of worker-focused economic principles</li>
          </ul>
            
          <h3 className="text-xl font-semibold">Conclusion</h3>
          <p>
            The Rose Token represents a fundamentally different approach to cryptocurrency economies - one that values 
            human contribution over capital, cooperation over competition, and equitable distribution over concentration 
            of wealth. By aligning economic incentives with worker-focused principles, we aim to demonstrate that blockchain 
            technology can be used to create more just and equitable economic systems.
          </p>
        </div>
      </CollapsibleSection>
        
      <CollapsibleSection id="faq" title="Frequently Asked Questions">
        <div className="space-y-4">
          {[
            {
              q: "How do I earn ROSE tokens?",
              a: "You can earn ROSE tokens in two primary ways: by completing tasks as a Worker (earning 95% of deposited tokens) or by validating work as a Stakeholder (earning 5% of deposited tokens)."
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
              a: "Currently, Rose Token operates on the Hoodi testnet (with Sepolia as a fallback). Mainnet deployment is planned for the future once thorough testing and auditing are complete."
            },
            {
              q: "What fees are associated with using the platform?",
              a: "The platform itself doesn't charge fees beyond standard Ethereum gas fees for transactions. All value transfers in the system are transparent and follow our worker distribution model."
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
              <div className="p-4 rounded-xl" style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--border-subtle)' }}>
                <h4 className="font-bold" style={{ color: 'var(--text-primary)' }}>Problem: MetaMask not connecting</h4>
                <p className="mt-2" style={{ color: 'var(--text-secondary)' }}>Try these steps:</p>
                <ol className="list-decimal pl-5 mt-2" style={{ color: 'var(--text-secondary)' }}>
                  <li>Ensure MetaMask is installed and unlocked</li>
                  <li>Refresh the page and try connecting again</li>
                  <li>Check if you're on the correct network (Hoodi or Sepolia)</li>
                  <li>Clear browser cache and cookies</li>
                  <li>Try using a different browser</li>
                </ol>
              </div>

              <div className="p-4 rounded-xl" style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--border-subtle)' }}>
                <h4 className="font-bold" style={{ color: 'var(--text-primary)' }}>Problem: Wrong network showing</h4>
                <p className="mt-2" style={{ color: 'var(--text-secondary)' }}>Our platform supports Hoodi (recommended) and Sepolia testnets. To switch networks:</p>
                <ol className="list-decimal pl-5 mt-2" style={{ color: 'var(--text-secondary)' }}>
                  <li>Click the network dropdown in MetaMask</li>
                  <li>Select "Hoodi Testnet" or "Sepolia Test Network"</li>
                  <li>If not visible, go to MetaMask Settings {'->'} Networks {'->'} Add Network</li>
                  <li>For Hoodi: RPC URL: https://rpc.hoodi.ethpandaops.io, Chain ID: 560048</li>
                  <li>For Sepolia: RPC URL: https://sepolia.infura.io/v3/YOUR_INFURA_KEY, Chain ID: 11155111</li>
                </ol>
              </div>
            </div>
          </div>
            
          <div className="mb-4">
            <h3 className="text-xl font-semibold mb-3">Transaction Issues</h3>
            <div className="space-y-4">
              <div className="p-4 rounded-xl" style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--border-subtle)' }}>
                <h4 className="font-bold" style={{ color: 'var(--text-primary)' }}>Problem: Transaction pending for too long</h4>
                <ol className="list-decimal pl-5 mt-2" style={{ color: 'var(--text-secondary)' }}>
                  <li>Check Sepolia gas prices and ensure you've set an appropriate gas fee</li>
                  <li>In MetaMask, you can speed up the transaction by clicking on the pending transaction and selecting "Speed Up"</li>
                  <li>Alternatively, you can cancel the transaction and try again</li>
                </ol>
              </div>

              <div className="p-4 rounded-xl" style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--border-subtle)' }}>
                <h4 className="font-bold" style={{ color: 'var(--text-primary)' }}>Problem: Transaction failed</h4>
                <p className="mt-2" style={{ color: 'var(--text-secondary)' }}>Common reasons for failure:</p>
                <ul className="list-disc pl-5 mt-2" style={{ color: 'var(--text-secondary)' }}>
                  <li>Insufficient ETH for gas</li>
                  <li>Contract error (check the specific error message)</li>
                  <li>Network congestion</li>
                </ul>
                <p className="mt-2" style={{ color: 'var(--text-secondary)' }}>Try increasing your gas limit or waiting for network conditions to improve.</p>
              </div>
            </div>
          </div>
            
          <div>
            <h3 className="text-xl font-semibold mb-3">Task-Related Issues</h3>
            <div className="space-y-4">
              <div className="p-4 rounded-xl" style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--border-subtle)' }}>
                <h4 className="font-bold" style={{ color: 'var(--text-primary)' }}>Problem: Can't claim a task</h4>
                <p className="mt-2" style={{ color: 'var(--text-secondary)' }}>Possible reasons:</p>
                <ul className="list-disc pl-5 mt-2" style={{ color: 'var(--text-secondary)' }}>
                  <li>The task has already been claimed by another worker</li>
                  <li>The task deadline has passed</li>
                  <li>You're already working on too many tasks</li>
                  <li>You don't meet task requirements (if implemented)</li>
                </ul>
              </div>

              <div className="p-4 rounded-xl" style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--border-subtle)' }}>
                <h4 className="font-bold" style={{ color: 'var(--text-primary)' }}>Problem: Submitted work not being validated</h4>
                <p className="mt-2" style={{ color: 'var(--text-secondary)' }}>Validation can take time depending on stakeholder availability. If it's been more than 72 hours:</p>
                <ol className="list-decimal pl-5 mt-2" style={{ color: 'var(--text-secondary)' }}>
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
              definition: "The native ERC20 token of the platform, distributed according to worker-focused principles when tasks are completed."
            },
            {
              term: "Customer",
              definition: "A user who creates tasks and provides ETH deposits for their completion."
            },
            {
              term: "Worker",
              definition: "A user who claims and completes tasks, earning 95% of deposited ROSE tokens upon successful validation."
            },
            {
              term: "Stakeholder",
              definition: "A user who validates completed work and arbitrates disputes, earning 5% of deposited ROSE tokens."
            },
            {
              term: "DAO Treasury",
              definition: "A community-controlled fund that receives 2% of all deposited ROSE tokens for governance and future development."
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
              term: "Worker Distribution Model",
              definition: "The economic system whereby value is distributed primarily to workers (95%) rather than capital owners."
            },
            {
              term: "MetaMask",
              definition: "The primary wallet interface used to interact with the Rose Token platform."
            },
            {
              term: "Hoodi",
              definition: "The recommended Ethereum testnet where the Rose Token platform is currently deployed. A newer testnet introduced for the Fusaka upgrade."
            },
            {
              term: "Sepolia",
              definition: "An alternative Ethereum testnet supported by Rose Token platform."
            }
          ].map((item, index) => (
            <div key={index} className="border-b pb-4">
              <h4 className="font-bold text-lg">{item.term}</h4>
              <p>{item.definition}</p>
            </div>
          ))}
        </div>
      </CollapsibleSection>
      
      <CollapsibleSection id="bugReports" title="Bug Reports & Feedback">
        <div className="space-y-6">
          <p className="text-lg">
            Help us improve Rose Token by reporting bugs and issues you encounter. 
            All bug reports are stored on IPFS for transparency and permanence.
          </p>
          
          {/* Error and success messages */}
          {bugError && (
            <div className="p-3 rounded-xl" style={{ background: 'var(--error-bg)', border: '1px solid rgba(248, 113, 113, 0.3)', color: 'var(--error)' }}>
              {bugError}
            </div>
          )}

          {bugSuccess && (
            <div className="p-3 rounded-xl" style={{ background: 'var(--success-bg)', border: '1px solid rgba(74, 222, 128, 0.3)', color: 'var(--success)' }}>
              {bugSuccess}
            </div>
          )}
          
          {/* Submit Bug Report Section */}
          <div className="pt-6" style={{ borderTop: '1px solid var(--border-subtle)' }}>
            <h3 className="text-xl font-semibold mb-4">Submit a Bug Report</h3>
            <form onSubmit={handleBugSubmit} className="space-y-4">
              <div>
                <label className="block text-xs uppercase tracking-widest font-medium mb-2" style={{ color: 'var(--text-muted)' }}>
                  Title <span style={{ color: 'var(--error)' }}>*</span>
                </label>
                <input
                  type="text"
                  value={bugTitle}
                  onChange={(e) => setBugTitle(e.target.value)}
                  className="w-full p-3 rounded-xl"
                  style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
                  placeholder="Brief description of the issue"
                  required
                />
              </div>

              <div>
                <label className="block text-xs uppercase tracking-widest font-medium mb-2" style={{ color: 'var(--text-muted)' }}>
                  Description <span style={{ color: 'var(--error)' }}>*</span>
                </label>
                <textarea
                  value={bugDescription}
                  onChange={(e) => setBugDescription(e.target.value)}
                  className="w-full p-3 rounded-xl h-24"
                  style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
                  placeholder="Detailed description of the bug"
                  required
                />
              </div>

              <div>
                <label className="block text-xs uppercase tracking-widest font-medium mb-2" style={{ color: 'var(--text-muted)' }}>
                  Steps to Reproduce
                </label>
                <textarea
                  value={bugSteps}
                  onChange={(e) => setBugSteps(e.target.value)}
                  className="w-full p-3 rounded-xl h-24"
                  style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
                  placeholder="1. Go to...&#10;2. Click on...&#10;3. See error..."
                />
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="py-2 px-4 rounded-xl font-semibold transition-all duration-300 hover:-translate-y-0.5 disabled:opacity-50"
                style={{
                  background: 'linear-gradient(135deg, var(--rose-pink) 0%, var(--rose-gold) 100%)',
                  color: 'var(--bg-primary)',
                  boxShadow: '0 4px 16px rgba(212, 165, 165, 0.3)'
                }}
              >
                {isSubmitting ? 'Submitting...' : 'Submit Bug Report'}
              </button>
            </form>

            {submittedCid && (
              <div className="mt-4 p-3 rounded-xl" style={{ background: 'var(--info-bg)', border: '1px solid rgba(96, 165, 250, 0.3)', color: 'var(--info)' }}>
                <p>Your bug report has been stored on IPFS.</p>
                <p className="text-sm mt-1">
                  <strong>CID:</strong> {submittedCid}
                </p>
                <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
                  Save this CID to reference your bug report later.
                </p>
              </div>
            )}
          </div>
          
          {/* View Submitted Reports Section */}
          <div className="pt-6" style={{ borderTop: '1px solid var(--border-subtle)' }}>
            <h3 className="text-xl font-semibold mb-4">Your Submitted Bug Reports</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* List of reports */}
              <div className="md:col-span-1 pr-4" style={{ borderRight: '1px solid var(--border-subtle)' }}>
                {bugReports.length === 0 ? (
                  <p style={{ color: 'var(--text-muted)' }}>No bug reports submitted yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {bugReports.map((report) => (
                      <li
                        key={report.cid}
                        className="p-3 rounded-xl cursor-pointer transition-all duration-200"
                        style={{
                          background: selectedReport?.cid === report.cid ? 'var(--info-bg)' : 'rgba(255, 255, 255, 0.02)',
                          border: selectedReport?.cid === report.cid ? '1px solid rgba(96, 165, 250, 0.3)' : '1px solid var(--border-subtle)'
                        }}
                        onClick={() => fetchReportDetails(report.cid)}
                      >
                        <h4 className="font-medium truncate" style={{ color: 'var(--text-primary)' }}>{report.title}</h4>
                        <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                          {formatDate(report.timestamp)}
                        </p>
                        <p className="text-xs mt-1 truncate" style={{ color: 'var(--text-muted)' }}>
                          CID: {report.cid}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Report details */}
              <div className="md:col-span-2 pl-4">
                {isLoadingReport ? (
                  <div className="flex justify-center items-center h-40">
                    <p style={{ color: 'var(--text-secondary)' }}>Loading report details...</p>
                  </div>
                ) : selectedReport ? (
                  <div>
                    <h4 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{selectedReport.title}</h4>
                    <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
                      Submitted on {formatDate(selectedReport.timestamp)}
                    </p>

                    <div className="mb-4">
                      <h5 className="text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Description</h5>
                      <div className="p-3 rounded-xl" style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--border-subtle)' }}>
                        <p className="whitespace-pre-wrap" style={{ color: 'var(--text-secondary)' }}>{selectedReport.description}</p>
                      </div>
                    </div>

                    {selectedReport.steps && (
                      <div className="mb-4">
                        <h5 className="text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Steps to Reproduce</h5>
                        <div className="p-3 rounded-xl" style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--border-subtle)' }}>
                          <p className="whitespace-pre-wrap" style={{ color: 'var(--text-secondary)' }}>{selectedReport.steps}</p>
                        </div>
                      </div>
                    )}

                    <div className="mt-4 text-xs" style={{ color: 'var(--text-muted)' }}>
                      <p>IPFS Content Identifier (CID): {selectedReport.cid}</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex justify-center items-center h-40" style={{ color: 'var(--text-muted)' }}>
                    <p>Select a report to view details</p>
                  </div>
                )}
              </div>
            </div>
          </div>
          
          {/* Look Up Report by CID Section */}
          <div className="pt-6" style={{ borderTop: '1px solid var(--border-subtle)' }}>
            <h3 className="text-xl font-semibold mb-4">Look Up Bug Report by CID</h3>
            <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
              If you have a CID from a previously submitted bug report, you can look it up here.
            </p>

            <form onSubmit={handleLookupReport} className="mb-6">
              <div className="flex flex-col md:flex-row gap-2">
                <input
                  type="text"
                  value={lookupCid}
                  onChange={(e) => setLookupCid(e.target.value)}
                  placeholder="Enter IPFS Content Identifier (CID)"
                  className="flex-grow p-3 rounded-xl"
                  style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
                  required
                />
                <button
                  type="submit"
                  disabled={isLookingUp}
                  className="py-2 px-4 rounded-xl font-semibold transition-all duration-300 hover:-translate-y-0.5 disabled:opacity-50"
                  style={{
                    background: 'linear-gradient(135deg, var(--rose-pink) 0%, var(--rose-gold) 100%)',
                    color: 'var(--bg-primary)',
                    boxShadow: '0 4px 16px rgba(212, 165, 165, 0.3)'
                  }}
                >
                  {isLookingUp ? 'Looking up...' : 'Look Up Report'}
                </button>
              </div>
            </form>

            {isLookingUp ? (
              <div className="flex justify-center items-center h-40">
                <p style={{ color: 'var(--text-secondary)' }}>Loading report details...</p>
              </div>
            ) : lookupReport ? (
              <div className="rounded-xl p-4" style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--border-subtle)' }}>
                <h4 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{lookupReport.title}</h4>
                <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
                  Submitted on {formatDate(lookupReport.timestamp)}
                </p>

                <div className="mb-4">
                  <h5 className="text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Description</h5>
                  <div className="p-3 rounded-xl" style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--border-subtle)' }}>
                    <p className="whitespace-pre-wrap" style={{ color: 'var(--text-secondary)' }}>{lookupReport.description}</p>
                  </div>
                </div>

                {lookupReport.steps && (
                  <div className="mb-4">
                    <h5 className="text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Steps to Reproduce</h5>
                    <div className="p-3 rounded-xl" style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--border-subtle)' }}>
                      <p className="whitespace-pre-wrap" style={{ color: 'var(--text-secondary)' }}>{lookupReport.steps}</p>
                    </div>
                  </div>
                )}

                <div className="mt-4 text-xs" style={{ color: 'var(--text-muted)' }}>
                  <p>IPFS Content Identifier (CID): {lookupReport.cid}</p>
                </div>
              </div>
            ) : (
              <div className="flex justify-center items-center h-40 rounded-xl" style={{ color: 'var(--text-muted)', border: '1px dashed var(--border-subtle)' }}>
                <p>Enter a CID to look up a bug report</p>
              </div>
            )}
          </div>
        </div>
      </CollapsibleSection>
    </div>
  );
};

export default HelpPage;
