import { config } from '../config';
import { PassportScore } from '../types';

export async function getPassportScore(address: string): Promise<number> {
  const url = `${config.gitcoin.baseUrl}/registry/score/${config.gitcoin.scorerId}/${address}`;

  const response = await fetch(url, {
    headers: {
      'X-API-KEY': config.gitcoin.apiKey,
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      // No passport found for this address
      return 0;
    }
    throw new Error(`Gitcoin API error: ${response.status}`);
  }

  const data = await response.json() as PassportScore;

  if (data.status === 'ERROR') {
    throw new Error(data.error || 'Passport verification failed');
  }

  return parseFloat(data.score) || 0;
}
