const {
  BaseKonnector,
  requestFactory,
  signin,
  scrape,
  saveBills,
  log,
  htmlToPDF,
  createCozyPDFDocument
} = require('cozy-konnector-libs')
const moment = require('moment')
moment.locale('fr')
const request = requestFactory({
  cheerio: true,
  json: false,
  jar: true
})

const baseUrl = 'https://boutique.monde-diplomatique.fr'
const invoicesURL = `${baseUrl}/sales/order/history/`

module.exports = new BaseKonnector(start)

async function start(fields) {
  log('info', 'Authenticating…')
  await authenticate(fields.login, fields.password)
  log('info', 'Successfully logged in')
  log('info', 'Fetching the list of documents')
  const $ = await request(invoicesURL)
  log('info', 'Parsing list of documents')
  const documents = await parseDocuments($)

  log('info', 'Saving data to Cozy')
  await saveBills(documents, fields.folderPath, {
    identifiers: ['books']
  })
}

function authenticate(email, mot_de_passe) {
  return signin({
    url: `https://www.monde-diplomatique.fr/sso/connexion/?retour=https%3A%2F%2Fboutique.monde-diplomatique.fr%2Fcustomer%2Faccount`,
    formSelector: 'form#identification_sso',
    formData: { email, mot_de_passe },
    validate: (statusCode, $) => {
      if ($('#session_deconnexion').length === 1) {
        return true
      } else {
        log('error', $('.error').text())
        return false
      }
    }
  })
}

function parseDocuments($) {
  const docs = scrape(
    $,
    {
      date: {
        sel: 'td:nth-child(1) span:nth-child(2)',
        parse: text => moment(text, 'DD/MM/YYYY').toDate()
      },
      title: {
        sel: 'td:nth-child(2)',
        fn: extractText
      },
      amount: {
        sel: 'td:nth-child(4)',
        fn: extractText,
        parse: text => /(\d+,\d+)/g.exec(text)[0]
      },
      numero: {
        sel: 'td:nth-child(3)',
        fn: extractText
      }
    },
    '.achats-ligne'
  )
  return Promise.all(
    docs.map(async doc => ({
      ...doc,
      currency: 'EUR',
      vendor: 'le monde diplomatique',
      metadata: {
        importDate: new Date(),
        version: 1
      },
      filename: createFilename(doc),
      filestream: await generatePDF(doc.numero)
    }))
  )
}

const createFilename = ({ title, numero, amount }) =>
  `${title.replace(' ', '-')}-${numero}-${amount}-EUR.pdf`

async function generatePDF(num) {
  const url = `https://boutique.monde-diplomatique.fr/gsales/order/view/id/${num}`
  const doc = createCozyPDFDocument(
    'Généré automatiquement par le connecteur Le Monde Diplomatique depuis la page',
    url
  )
  const $ = await request(url)
  htmlToPDF($, doc, $('.my-account'), {
    baseURL: url
  })
  doc.end()
  return doc
}

/**
 * @param  {Object} node - a cheerio.js.org node
 *
 * @example
 * // given
 * // "<span>Some unuseful text</span>
 * //           The useful text    "
 * // as the node content, it returns
 * // "The useful text"
 *
 * @returns {string} Returns the second line of the node
 */
function extractText(node) {
  return node
    .contents()
    .get(2)
    .data.trim()
}
