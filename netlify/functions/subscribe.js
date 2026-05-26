const https = require('https');
const crypto = require('crypto');

exports.handler = async (event) => {
  // Solo permitir peticiones POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { email, tags = [] } = JSON.parse(event.body);

    if (!email) {
      return { statusCode: 400, body: JSON.stringify({ error: 'El email es requerido' }) };
    }

    const apiKey = process.env.MAILCHIMP_API_KEY;
    const audienceId = process.env.MAILCHIMP_AUDIENCE_ID;

    if (!apiKey || !audienceId) {
      console.error('La clave de API de Mailchimp o el ID de la audiencia no están configurados en Netlify.');
      return { statusCode: 500, body: JSON.stringify({ error: 'Error de configuración en el servidor' }) };
    }

    // Extraer el centro de datos de la clave API (ej. "abcd-us14" -> "us14")
    // Usar pop() maneja correctamente claves con múltiples guiones
    const datacenter = apiKey.split('-').pop();
    
    // El hash del suscriptor en Mailchimp es el MD5 del email en minúsculas
    const subscriberHash = crypto.createHash('md5').update(email.toLowerCase()).digest('hex');

    // 1. Suscribir al usuario (PUT /members/:hash)
    const url = `https://${datacenter}.api.mailchimp.com/3.0/lists/${audienceId}/members/${subscriberHash}`;

    // Configuración para añadir/actualizar al miembro
    const memberData = JSON.stringify({
      email_address: email,
      status_if_new: 'subscribed'
    });

    const memberOptions = {
      method: 'PUT',
      headers: {
        'Authorization': `apikey ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(memberData)
      }
    };

    const subscribeResponse = await new Promise((resolve, reject) => {
      const req = https.request(url, memberOptions, (res) => {
        let responseBody = '';
        res.on('data', (chunk) => { responseBody += chunk; });
        res.on('end', () => {
          resolve({ statusCode: res.statusCode, body: responseBody });
        });
      });
      req.on('error', reject);
      req.write(memberData);
      req.end();
    });

    if (subscribeResponse.statusCode >= 300) {
      console.error('Error suscribiendo:', subscribeResponse.body);
      return {
        statusCode: subscribeResponse.statusCode,
        body: JSON.stringify({ error: 'Error al suscribir en Mailchimp', details: JSON.parse(subscribeResponse.body || '{}') })
      };
    }

    // 2. Aplicar etiquetas (POST /members/:hash/tags)
    const tagsToAdd = tags.length > 0 ? tags : ['Lead Magnet Módulo 1'];
    
    const formattedTags = tagsToAdd.map(tag => ({
      name: tag,
      status: 'active'
    }));

    const tagsData = JSON.stringify({ tags: formattedTags });
    const tagsUrl = `https://${datacenter}.api.mailchimp.com/3.0/lists/${audienceId}/members/${subscriberHash}/tags`;
    
    const tagsOptions = {
      method: 'POST',
      headers: {
        'Authorization': `apikey ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(tagsData)
      }
    };

    const tagsResponse = await new Promise((resolve, reject) => {
      const req = https.request(tagsUrl, tagsOptions, (res) => {
        let responseBody = '';
        res.on('data', (chunk) => { responseBody += chunk; });
        res.on('end', () => resolve({ statusCode: res.statusCode, body: responseBody }));
      });
      req.on('error', reject);
      req.write(tagsData);
      req.end();
    });

    if (tagsResponse.statusCode >= 300) {
      console.error('Error agregando etiquetas:', tagsResponse.body);
      // No fallamos la petición completa si solo fallan las etiquetas, pero lo logueamos
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, message: '¡Te has suscrito exitosamente!' })
    };

  } catch (error) {
    console.error('Error en la función subscribe:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Error interno del servidor' })
    };
  }
};
