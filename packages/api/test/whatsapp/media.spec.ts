import { deepEqual, equal } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { bodyForModel } from '../../src/whatsapp/location';
import {
  formatMediaBody,
  formatTranscriptBody,
  isMediaOnly,
  MediaKind,
  parseMediaBody
} from '../../src/whatsapp/media';

describe('media bodies', () => {
  it('round-trips the kind and the caption', () => {
    deepEqual(parseMediaBody(formatMediaBody(MediaKind.Audio)), { kind: MediaKind.Audio, caption: null });
    deepEqual(parseMediaBody(formatMediaBody(MediaKind.Image, 'essa: aqui')), {
      kind: MediaKind.Image,
      caption: 'essa: aqui'
    });
    equal(parseMediaBody('quero uma pizza'), undefined);
  });

  it('tells the model what it cannot open, keeping the caption', () => {
    equal(bodyForModel('🎤 Áudio'), '[o cliente enviou um áudio, que você não consegue ouvir]');
    equal(
      bodyForModel('🖼️ Imagem: igual a essa'),
      '[o cliente enviou uma imagem, que você não consegue ver] igual a essa'
    );
    equal(bodyForModel('📍 Localização: -23.550520,-46.633308'), '📍 Localização enviada');
    equal(bodyForModel('oi'), 'oi');
  });

  it('gives the model a transcript as text, flagged as automatic', () => {
    const body = formatTranscriptBody('uma calabresa grande');

    equal(body, '🎤 Áudio transcrito: uma calabresa grande');
    equal(parseMediaBody(body), undefined);
    equal(isMediaOnly(body), false);
    equal(bodyForModel(body).startsWith('[áudio do cliente, transcrito automaticamente'), true);
    equal(bodyForModel(body).endsWith('] uma calabresa grande'), true);
  });

  it('treats only media without a caption as unreadable', () => {
    equal(isMediaOnly('🎤 Áudio'), true);
    equal(isMediaOnly('💬 Figurinha'), true);
    equal(isMediaOnly('🖼️ Imagem: essa'), false);
    equal(isMediaOnly('oi'), false);
  });
});
