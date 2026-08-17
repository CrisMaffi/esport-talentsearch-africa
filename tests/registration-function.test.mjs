import assert from 'node:assert/strict';
import test from 'node:test';

import { handleRegistration } from '../functions/register.js';

const registrationRequest = (overrides = {}, accept = 'application/json') => {
    const fields = {
        'form-name': 'digital-grand-prix-interest',
        'bot-field': '',
        name: 'Test Participant',
        email: 'participant@example.com',
        country: 'Ethiopia',
        city: 'Addis Ababa',
        interest: 'developer-edition-competitor',
        skills: 'Telemetry analysis',
        portfolio: 'https://example.com',
        message: 'Testing the registration route.',
        consent: 'yes',
        ...overrides
    };

    return new Request('https://www.esport-talentsearch.africa/register', {
        method: 'POST',
        headers: {
            Accept: accept,
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams(fields).toString()
    });
};

test('forwards a valid registration to the ETSA form collector', async () => {
    let forwarded;
    const fetchMock = async (url, options) => {
        forwarded = { url, options };
        return new Response('accepted', { status: 200 });
    };

    const response = await handleRegistration(registrationRequest(), fetchMock);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(forwarded.url, 'https://creative-cupcake-fb6b5e.netlify.app/');
    assert.equal(forwarded.options.method, 'POST');

    const forwardedFields = new URLSearchParams(forwarded.options.body);
    assert.equal(forwardedFields.get('form-name'), 'digital-grand-prix-interest');
    assert.equal(forwardedFields.get('email'), 'participant@example.com');
    assert.equal(forwardedFields.get('consent'), 'yes');
});

test('rejects incomplete registrations without forwarding them', async () => {
    let fetchCalled = false;
    const response = await handleRegistration(
        registrationRequest({ email: '', consent: '' }),
        async () => {
            fetchCalled = true;
            return new Response('accepted');
        }
    );

    assert.equal(response.status, 400);
    assert.equal(fetchCalled, false);
    assert.equal((await response.json()).ok, false);
});

test('silently accepts honeypot submissions without forwarding them', async () => {
    let fetchCalled = false;
    const response = await handleRegistration(
        registrationRequest({ 'bot-field': 'automated spam' }),
        async () => {
            fetchCalled = true;
            return new Response('accepted');
        }
    );

    assert.equal(response.status, 200);
    assert.equal(fetchCalled, false);
    assert.deepEqual(await response.json(), { ok: true });
});

test('redirects no-script registrations to the ETSA thank-you page', async () => {
    const response = await handleRegistration(
        registrationRequest({}, 'text/html'),
        async () => new Response('accepted', { status: 200 })
    );

    assert.equal(response.status, 303);
    assert.equal(response.headers.get('Location'), 'https://www.esport-talentsearch.africa/thank-you.html');
});

