import { deepEqual, equal, throws } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseImport, ProspectImportError } from '../../src/prospecting/import';

const lead = (extra: Record<string, unknown> = {}) => ({
  name: 'Pizzaria Exemplo',
  phone: '(11) 98765-4321',
  messages: ['Oi, tudo bem?', 'Oi! Posso falar com você?'],
  ...extra
});

describe('prospecting import', () => {
  it('parses a valid row', () => {
    const result = parseImport({ leads: [lead({ info: { bairro: 'Penha', notas: 3, lista: [1], nulo: null } })] });

    deepEqual(result.errors, []);
    equal(result.duplicates, 0);
    deepEqual(result.rows, [
      {
        name: 'Pizzaria Exemplo',
        phone: '5511987654321',
        messages: ['Oi, tudo bem?', 'Oi! Posso falar com você?'],
        info: { bairro: 'Penha', notas: 3 },
        details: {}
      }
    ]);
  });

  it('reports one error per invalid row', () => {
    const cases: [unknown, string][] = [
      [lead({ name: '  ' }), 'Nome em branco'],
      [lead({ phone: '123' }), 'Telefone inválido'],
      [lead({ messages: ['só uma'] }), 'Precisa de 2 a 4 mensagens'],
      [lead({ messages: ['a', 'b', 'c', 'd', 'e'] }), 'Precisa de 2 a 4 mensagens'],
      [lead({ messages: ['a', 'x'.repeat(501)] }), 'Mensagem com mais de 500 caracteres'],
      [lead({ messages: ['a', 'veja https://x'] }), 'Mensagem com link'],
      [lead({ messages: ['a', 'veja www.x.com'] }), 'Mensagem com link'],
      [lead({ messages: ['a', 'chama wa.me/55'] }), 'Mensagem com link'],
      ['texto', 'Linha não é um objeto']
    ];

    for (const [row, reason] of cases) {
      const result = parseImport({ leads: [row] });

      equal(result.rows.length, 0, reason);
      deepEqual(result.errors, [{ row: 1, reason }]);
    }
  });

  it('numbers errors from 1', () => {
    const result = parseImport({ leads: [lead(), lead({ name: '' })] });

    equal(result.rows.length, 1);
    deepEqual(result.errors, [{ row: 2, reason: 'Nome em branco' }]);
  });

  it('counts a phone that differs only by the mobile 9 as a duplicate', () => {
    const result = parseImport({ leads: [lead(), lead({ phone: '551187654321' })] });

    equal(result.rows.length, 1);
    equal(result.duplicates, 1);
  });

  it('refuses a whole file that is malformed or too big', () => {
    throws(() => parseImport({ leads: Array(2001).fill(lead()) }), ProspectImportError);
    throws(() => parseImport(null), ProspectImportError);
    throws(() => parseImport({}), ProspectImportError);
  });

  it('parses the optional lead fields into details', () => {
    const result = parseImport({
      leads: [
        lead({
          category: ' Pizzaria ',
          neighborhood: 'Penha',
          zone: 'Zona Leste',
          city: 'São Paulo',
          postal_code: '03600-000',
          situation: 'whatsapp',
          systems: [
            { name: 'Anota AI', kind: 'bot', source: 'site' },
            { name: 'iFood', kind: 'market' }
          ],
          rating: 4.5,
          reviews: 120,
          score: 8,
          site: 'www.x.com.br',
          mobile: true
        })
      ]
    });

    deepEqual(result.errors, []);
    deepEqual(result.rows[0]?.details, {
      category: 'Pizzaria',
      neighborhood: 'Penha',
      zone: 'Zona Leste',
      city: 'São Paulo',
      postalCode: '03600-000',
      situation: 'whatsapp',
      systems: [
        { name: 'Anota AI', kind: 'bot', source: 'site' },
        { name: 'iFood', kind: 'market' }
      ],
      rating: 4.5,
      reviews: 120,
      score: 8,
      site: 'www.x.com.br',
      mobile: true
    });
  });

  it('treats empty optional fields as absent', () => {
    const result = parseImport({ leads: [lead({ zone: '', city: '  ', score: 3 })] });

    deepEqual(result.errors, []);
    deepEqual(result.rows[0]?.details, { score: 3 });
  });

  it('rejects invalid optional fields', () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ situation: 'x' }, 'Situação inválida'],
      [{ score: 11 }, 'Nota (score) deve ser um inteiro de 0 a 10'],
      [{ score: 2.5 }, 'Nota (score) deve ser um inteiro de 0 a 10'],
      [{ rating: 6 }, 'Avaliação (rating) deve ser de 0 a 5'],
      [{ reviews: -1 }, 'Avaliações (reviews) deve ser um inteiro a partir de 0'],
      [{ mobile: 'sim' }, 'Celular (mobile) deve ser verdadeiro ou falso'],
      [{ systems: [{ name: '', kind: 'bot' }] }, 'Sistema inválido'],
      [{ systems: [{ name: 'X', kind: 'y' }] }, 'Sistema inválido'],
      [{ category: 3 }, 'Campo inválido: Categoria']
    ];

    for (const [extra, reason] of cases) {
      const result = parseImport({ leads: [lead(extra)] });

      equal(result.rows.length, 0, reason);
      deepEqual(result.errors, [{ row: 1, reason }]);
    }
  });
});
