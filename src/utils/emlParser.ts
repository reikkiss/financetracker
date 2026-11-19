import { parseBankEmailAlert, ParsedEmailTransaction } from './bankEmailParser';

function decodeRfc2047Word(input: string): string {
  if (!input) return '';
  return input
    .replace(/\?=\s+=\?/g, '?==?')
    .replace(/=\?([^?]+)\?([BQ])\?([^?]+)\?=/gi, (full, charsetRaw, encodingRaw, encodedText) => {
      try {
        const charset = String(charsetRaw || 'utf-8').toLowerCase();
        const encoding = String(encodingRaw || 'B').toUpperCase();
        let bytes: Uint8Array;

        if (encoding === 'B') {
          const bin = atob(encodedText.replace(/\s+/g, ''));
          bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        } else {
          const qp = encodedText.replace(/_/g, ' ');
          const rawBytes: number[] = [];
          for (let i = 0; i < qp.length; i++) {
            if (qp[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(qp.slice(i + 1, i + 3))) {
              rawBytes.push(parseInt(qp.slice(i + 1, i + 3), 16));
              i += 2;
            } else {
              rawBytes.push(qp.charCodeAt(i));
            }
          }
          bytes = new Uint8Array(rawBytes);
        }

        if (charset.includes('iso-8859') || charset.includes('latin1') || charset.includes('1252')) {
          return new TextDecoder('windows-1252').decode(bytes);
        }
        try {
          return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        } catch {
          return new TextDecoder('windows-1252').decode(bytes);
        }
      } catch {
        return full;
      }
    });
}

function extractHeadersFromRawEml(raw: string): {
  subject: string;
  from: string;
  date: string;
  messageId: string;
} {
  const splitMatch = raw.match(/\r?\n\r?\n/);
  const headerBlock = splitMatch && splitMatch.index !== undefined ? raw.slice(0, splitMatch.index) : raw.slice(0, 8000);
  // Unfold multi-line RFC 5322 headers
  const unfolded = headerBlock.replace(/\r?\n[ \t]+/g, ' ');

  const getHeader = (name: string): string => {
    const regex = new RegExp(`^${name}:\\s*(.+)$`, 'im');
    const match = unfolded.match(regex);
    return match ? decodeRfc2047Word(match[1].trim()) : '';
  };

  return {
    subject: getHeader('Subject'),
    from: getHeader('From'),
    date: getHeader('Date'),
    messageId: getHeader('Message-ID').replace(/[<>]/g, '').trim()
  };
}

function splitMboxMessages(rawText: string): string[] {
  // Standard mbox messages begin with "From <sender> <timestamp>" on line start
  const lines = rawText.split(/\r?\n/);
  const messages: string[] = [];
  let current: string[] = [];
  let sawFromLine = false;

  for (const line of lines) {
    if (/^From\s+\S+\s+.*(?:19|20)\d{2}/.test(line)) {
      if (current.length > 0 && sawFromLine) {
        messages.push(current.join('\n'));
      }
      current = [];
      sawFromLine = true;
    } else {
      current.push(line);
    }
  }

  if (current.length > 0) {
    messages.push(current.join('\n'));
  }

  return messages.length > 0 ? messages : [rawText];
}

export async function parseEmailFilesToAlerts(files: FileList | File[]): Promise<{
  totalEmailsScanned: number;
  alerts: ParsedEmailTransaction[];
}> {
  const fileArray = Array.from(files);
  const alerts: ParsedEmailTransaction[] = [];
  let totalEmailsScanned = 0;

  for (const file of fileArray) {
    const text = await file.text();
    const isMbox = file.name.toLowerCase().endsWith('.mbox') || /^From\s+\S+\s+.*(?:19|20)\d{2}/m.test(text.slice(0, 500));
    const rawMessages = isMbox ? splitMboxMessages(text) : [text];

    rawMessages.forEach((rawMsg, idx) => {
      if (!rawMsg.trim()) return;
      totalEmailsScanned++;
      const headers = extractHeadersFromRawEml(rawMsg);
      const parsed = parseBankEmailAlert(rawMsg, headers.subject, headers.from, headers.date);
      if (parsed) {
        const fallbackId = `${file.name}_${idx}_${parsed.date}_${parsed.amount}`;
        alerts.push({
          ...parsed,
          emailId: `icloud_file_${headers.messageId || fallbackId}`,
          rawSubject: headers.subject || file.name,
          rawSender: headers.from || 'iCloud Mail (.eml)'
        });
      }
    });
  }

  return { totalEmailsScanned, alerts };
}
