const FORM_NAME = 'digital-grand-prix-interest';
const NETLIFY_FORM_ENDPOINT = 'https://creative-cupcake-fb6b5e.netlify.app/';

const ALLOWED_INTERESTS = new Set([
    'developer-edition-competitor',
    'data-ai-future-class',
    'product-ux-future-class',
    'game-simulation-future-class',
    'hardware-embedded-future-class',
    'digital-media-operations-future-class',
    'mentor-judge',
    'sponsor-partner',
    'university-community'
]);

const jsonResponse = (payload, status = 200) => new Response(JSON.stringify(payload), {
    status,
    headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
    }
});

const textValue = (formData, name) => {
    const value = formData.get(name);
    return typeof value === 'string' ? value.trim() : '';
};

const wantsJson = (request) => request.headers.get('Accept')?.includes('application/json');

const successResponse = (request) => {
    if (wantsJson(request)) return jsonResponse({ ok: true });
    return Response.redirect(new URL('/thank-you.html', request.url).toString(), 303);
};

const errorResponse = (request, message, status) => {
    if (wantsJson(request)) return jsonResponse({ ok: false, message }, status);
    return new Response(`${message}\n\nPlease return to ETSA and use the email registration option.`, {
        status,
        headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-store'
        }
    });
};

export async function handleRegistration(request, fetchImpl = fetch) {
    let formData;

    try {
        formData = await request.formData();
    } catch {
        return errorResponse(request, 'The registration form could not be read.', 400);
    }

    // Silently accept honeypot submissions without forwarding them.
    if (textValue(formData, 'bot-field')) return successResponse(request);

    const name = textValue(formData, 'name');
    const email = textValue(formData, 'email');
    const country = textValue(formData, 'country');
    const interest = textValue(formData, 'interest');
    const consent = textValue(formData, 'consent');

    const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    const requiredFieldsAreValid =
        name.length >= 2 && name.length <= 120 &&
        email.length <= 200 && validEmail &&
        country.length >= 2 && country.length <= 120 &&
        ALLOWED_INTERESTS.has(interest) &&
        consent === 'yes';

    if (!requiredFieldsAreValid) {
        return errorResponse(request, 'Please check the required registration details and try again.', 400);
    }

    const limits = {
        city: 120,
        skills: 300,
        portfolio: 500,
        message: 2000
    };

    for (const [field, limit] of Object.entries(limits)) {
        if (textValue(formData, field).length > limit) {
            return errorResponse(request, 'One or more registration fields are too long.', 400);
        }
    }

    const payload = new URLSearchParams();
    for (const [key, value] of formData.entries()) {
        if (typeof value === 'string') payload.set(key, value.trim());
    }
    payload.set('form-name', FORM_NAME);

    try {
        const response = await fetchImpl(NETLIFY_FORM_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
            },
            body: payload.toString(),
            redirect: 'follow'
        });

        if (!response.ok) {
            throw new Error(`Registration collector returned HTTP ${response.status}`);
        }

        return successResponse(request);
    } catch (error) {
        console.error('ETSA registration forwarding failed:', error);
        return errorResponse(request, 'The online form could not be sent.', 502);
    }
}

export async function onRequestPost(context) {
    return handleRegistration(context.request);
}

export function onRequest() {
    return new Response('Method not allowed', {
        status: 405,
        headers: { Allow: 'POST' }
    });
}

