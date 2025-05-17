import * as openpgp from 'openpgp';

export const generateKeyPair = async (name, email) => {
  const { privateKey, publicKey } = await openpgp.generateKey({
    type: 'ecc', // ECC is more modern and has smaller keys than RSA
    curve: 'curve25519', // Modern curve for better security
    userIDs: [{ name, email }],
    format: 'armored'
  });
    
  return { privateKey, publicKey };
};

export const encryptForRecipients = async (content, publicKeys) => {
  const message = await openpgp.createMessage({ text: content });
  const encryptedMessage = await openpgp.encrypt({
    message,
    encryptionKeys: await Promise.all(publicKeys.map(key => openpgp.readKey({ armoredKey: key })))
  });
    
  return encryptedMessage;
};

export const decryptContent = async (encryptedContent, privateKey) => {
  const message = await openpgp.readMessage({
    armoredMessage: encryptedContent
  });
    
  const { data: decrypted } = await openpgp.decrypt({
    message,
    decryptionKeys: await openpgp.readPrivateKey({ armoredKey: privateKey })
  });
    
  return decrypted;
};
