const nodemailer = require("nodemailer");

exports.handler = async (event) => {
    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    const data = JSON.parse(event.body);

    const { fullname, email, phone, membershipFile } = data;

    // Email transport (use your own SMTP)
    const transporter = nodemailer.createTransport({
        host: "smtp.gmail.com",
        port: 465,
        secure: true,
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        }
    });

    const mailOptions = {
        from: `"ETSA Registration" <${process.env.EMAIL_USER}>`,
        to: "k.aebi@maffiracing.com, c.maffi@maffiracing.com",
        subject: "New ETSA Registration Submission",
        html: `
            <h2>New Registration</h2>
            <p><strong>Name:</strong> ${fullname}</p>
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Phone:</strong> ${phone}</p>
            <p><strong>Membership File:</strong> Attached</p>
        `,
        attachments: [
            {
                filename: membershipFile.filename,
                content: membershipFile.content,
                encoding: "base64"
            }
        ]
    };

    try {
        await transporter.sendMail(mailOptions);
        return { statusCode: 200, body: "Registration sent successfully." };
    } catch (error) {
        return { statusCode: 500, body: "Error sending registration." };
    }
};
