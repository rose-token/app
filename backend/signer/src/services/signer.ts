import { ethers } from 'ethers';
import { config } from '../config';
import { Action } from '../types';

const wallet = new ethers.Wallet(config.signer.privateKey);

export function getSignerAddress(): string {
  return wallet.address;
}

export async function signApproval(
  address: string,
  action: Action,
  expiry: number
): Promise<string> {
  // Create message hash matching contract's verification
  // Contract uses: keccak256(abi.encodePacked(msg.sender, action, expiry))
  const messageHash = ethers.solidityPackedKeccak256(
    ['address', 'string', 'uint256'],
    [address, action, expiry]
  );

  // Sign the hash (ethers adds "\x19Ethereum Signed Message:\n32" prefix)
  const signature = await wallet.signMessage(ethers.getBytes(messageHash));

  return signature;
}
