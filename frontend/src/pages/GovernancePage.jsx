import React from 'react';  
import { useEthereum } from '../hooks/useEthereum';  
  
const CollapsibleSection = ({ id, title, children }) => {  
  const [isOpen, setIsOpen] = React.useState(false);  
    
  return (  
    <div className="border rounded-lg overflow-hidden mb-4">  
      <button  
        id={id}  
        onClick={() => setIsOpen(!isOpen)}  
        className="w-full p-4 text-left font-semibold bg-muted flex justify-between items-center"  
      >  
        <span>{title}</span>  
        <span>{isOpen ? '−' : '+'}</span>  
      </button>  
      {isOpen && <div className="p-4">{children}</div>}  
    </div>  
  );  
};  
  
const GovernancePage = () => {  
  const { isConnected } = useEthereum();  
    
  return (  
    <div className="max-w-4xl mx-auto">  
      <h1 className="text-3xl font-bold mb-6">Rose Token Governance</h1>  
        
      <p className="mb-6 text-lg">  
        Rose Token operates on principles of community ownership and democratic decision-making.  
        The governance model ensures that all token holders have a voice in the project's future.  
      </p>  
        
      <CollapsibleSection id="dao-treasury" title="DAO Treasury">  
        <div className="space-y-4">  
          <p>  
            20% of all tokens minted from completed tasks go directly to the DAO treasury.  
            This treasury serves as the financial backbone for community governance initiatives.  
          </p>  
          <p>  
            The treasury funds are used for:  
          </p>  
          <ul className="list-disc pl-6 space-y-2">  
            <li>Platform development and improvements</li>  
            <li>Marketing and community outreach</li>  
            <li>Liquidity provision and token stability measures</li>  
            <li>Grants for projects that benefit the Rose Token ecosystem</li>  
          </ul>  
        </div>  
      </CollapsibleSection>  
        
      <CollapsibleSection id="voting-mechanism" title="Voting Mechanism">  
        <div className="space-y-4">  
          <p>  
            Rose Token uses a token-weighted voting system where each ROSE token represents one vote.  
            This ensures that those with the highest stake in the ecosystem have proportional influence  
            over its direction.  
          </p>  
          <p>  
            Key aspects of the voting mechanism:  
          </p>  
          <ul className="list-disc pl-6 space-y-2">  
            <li>One ROSE token equals one vote</li>  
            <li>Voting is conducted on-chain for transparency</li>  
            <li>Voting periods typically last 7 days</li>  
            <li>A minimum quorum of 10% of circulating tokens is required for a vote to be valid</li>  
          </ul>  
        </div>  
      </CollapsibleSection>  
        
      <CollapsibleSection id="proposal-system" title="Proposal System">  
        <div className="space-y-4">  
          <p>  
            Any ROSE token holder can submit proposals for community consideration.  
            Proposals can range from technical improvements to treasury allocations.  
          </p>  
          <p>  
            The proposal process follows these stages:  
          </p>  
          <ol className="list-decimal pl-6 space-y-2">  
            <li>  
              <strong>Proposal Submission</strong> - Authors must hold at least 1% of circulating supply   
              to submit proposals  
            </li>  
            <li>  
              <strong>Discussion Period</strong> - 3 days for community feedback and proposal refinement  
            </li>  
            <li>  
              <strong>Voting Period</strong> - 7 days for token holders to cast their votes  
            </li>  
            <li>  
              <strong>Execution</strong> - If approved, proposals are implemented by the development team  
            </li>  
          </ol>  
        </div>  
      </CollapsibleSection>  
        
      <CollapsibleSection id="governance-roadmap" title="Governance Roadmap">  
        <div className="space-y-4">  
          <p>  
            The Rose Token governance system will evolve over time to become increasingly decentralized.  
          </p>  
          <h3 className="text-xl font-semibold">Phase 1: Foundation (Current)</h3>  
          <ul className="list-disc pl-6 space-y-2">  
            <li>Treasury establishment with 20% of all minted tokens</li>  
            <li>Initial governance framework development</li>  
            <li>Community forums for discussion</li>  
          </ul>  
            
          <h3 className="text-xl font-semibold mt-4">Phase 2: Governance Token</h3>  
          <ul className="list-disc pl-6 space-y-2">  
            <li>Implementation of on-chain voting mechanisms</li>  
            <li>Proposal system launch</li>  
            <li>Snapshot voting integration</li>  
          </ul>  
            
          <h3 className="text-xl font-semibold mt-4">Phase 3: Full DAO</h3>  
          <ul className="list-disc pl-6 space-y-2">  
            <li>Transition to a fully community-governed DAO</li>  
            <li>Multi-signature treasury management</li>  
            <li>Delegation and representative systems</li>  
            <li>Governance incentive mechanisms</li>  
          </ul>  
        </div>  
      </CollapsibleSection>  
        
      {!isConnected && (  
        <div className="mt-8 p-4 bg-yellow-50 border border-yellow-200 rounded-md">  
          <p className="text-yellow-800">  
            Connect your wallet to participate in Rose Token governance. Once connected,  
            you'll be able to view active proposals and cast votes.  
          </p>  
        </div>  
      )}  
    </div>  
  );  
};  
  
export default GovernancePage;
