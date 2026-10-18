const {
    Client,
    GatewayIntentBits,
    Partials,
    PermissionsBitField,
    ChannelType,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ChannelSelectMenuBuilder,
    RoleSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    AttachmentBuilder
} = require("discord.js");

const fs = require("fs");
const path = require("path");
const http = require("http");

// ==========================================================
// USTAWIENIA I BEZPIECZNE ŚCIEŻKI
// ==========================================================

const TOKEN = process.env.DISCORD_TOKEN;
let DATA_DIR = process.env.DATA_DIR && typeof process.env.DATA_DIR === 'string' ? process.env.DATA_DIR : __dirname;

try {
    if (fs.existsSync(DATA_DIR) && !fs.lstatSync(DATA_DIR).isDirectory()) {
        console.warn(`⚠️ Ścieżka ${DATA_DIR} jest plikiem, a nie katalogiem! Przełączam na katalog bieżący.`);
        DATA_DIR = __dirname;
    }
} catch (e) {
    DATA_DIR = __dirname;
}

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

const CONFIG_FILE = path.join(DATA_DIR, "ticket-config.json");

// ==========================================================
// SERWER HTTP (DLA HOSTINGU / RENDER / COLIFY)
// ==========================================================

const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Bot Discord działa prawidłowo!");
});

server.listen(PORT, () => {
    console.log(`🌐 Serwer HTTP nasłuchuje na porcie ${PORT}`);
});

// ==========================================================
// OBSŁUGA BŁĘDÓW (ZAPOBIEGA CRASHOWANIU BOTA)
// ==========================================================

process.on("unhandledRejection", error => {
    console.error("❌ Nieobsłużone odrzucenie Promise:", error);
});

process.on("uncaughtException", error => {
    console.error("❌ Nieprzechwycony wyjątek:", error);
});

// ==========================================================
// KLIENT DISCORD
// ==========================================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ],
    partials: [
        Partials.Channel,
        Partials.GuildMember,
        Partials.Message
    ]
});

// ==========================================================
// DOMYŚLNA KONFIGURACJA
// ==========================================================

const defaultConfig = {
    supportRoleIds: [],
    ticketCategoryId: null,
    transcriptChannelId: null,
    verifiedRoleId: null,

    ticketPanel: {
        title: "🎫 SYSTEM TICKETÓW",
        description: "Wybierz rodzaj zgłoszenia:",
        placeholder: "📁 Wybierz kategorię"
    },

    verifyPanel: {
        title: "🔐 Weryfikacja tożsamości",
        description: "Kliknij poniższy przycisk, aby pomyślnie przejść weryfikację i odblokować dostęp do serwera.",
        buttonLabel: "Zweryfikuj się",
        buttonEmoji: "✅"
    },

    categories: [
        {
            id: "pomoc",
            name: "Pomoc",
            emoji: "🆘",
            description: "Potrzebuję pomocy",
            questions: [
                "W czym potrzebujesz pomocy?",
                "Od kiedy występuje problem?"
            ]
        },
        {
            id: "zgloszenie",
            name: "Zgłoszenie",
            emoji: "🚨",
            description: "Chcę zgłosić gracza",
            questions: [
                "Kogo zgłaszasz?",
                "Jaki jest powód zgłoszenia?",
                "Podaj dowody."
            ]
        },
        {
            id: "sklep",
            name: "Sklep",
            emoji: "🛒",
            description: "Problem ze sklepem",
            questions: [
                "Czego dotyczy problem?",
                "Podaj numer zamówienia."
            ]
        },
        {
            id: "odwolanie",
            name: "Odwołanie",
            emoji: "⚖️",
            description: "Odwołanie od bana lub innej kary",
            questions: [
                "Jaki jest Twój nick?",
                "Za co otrzymałeś karę?",
                "Dlaczego uważasz, że kara jest niesłuszna?"
            ]
        },
        {
            id: "inne",
            name: "Inne",
            emoji: "📌",
            description: "Inna sprawa",
            questions: [
                "Opisz swoją sprawę."
            ]
        }
    ]
};

// Śledzenie przejętych ticketów w pamięci bota (channelId -> userId)
const claimedTickets = new Map();

// ==========================================================
// ŁADOWANIE KONFIGURACJI
// ==========================================================

function loadConfig() {
    if (!fs.existsSync(CONFIG_FILE)) {
        fs.writeFileSync(
            CONFIG_FILE,
            JSON.stringify(defaultConfig, null, 4),
            "utf8"
        );
        return JSON.parse(JSON.stringify(defaultConfig));
    }

    try {
        const data = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
        const config = { ...defaultConfig, ...data };

        if (!Array.isArray(config.categories)) config.categories = [];
        if (!Array.isArray(config.supportRoleIds)) config.supportRoleIds = [];
        if (!config.ticketPanel || typeof config.ticketPanel !== "object") config.ticketPanel = {};
        if (!config.verifyPanel || typeof config.verifyPanel !== "object") config.verifyPanel = {};

        if (typeof config.ticketPanel.title !== "string") config.ticketPanel.title = defaultConfig.ticketPanel.title;
        if (typeof config.ticketPanel.description !== "string") config.ticketPanel.description = defaultConfig.ticketPanel.description;
        if (typeof config.ticketPanel.placeholder !== "string") config.ticketPanel.placeholder = defaultConfig.ticketPanel.placeholder;

        if (typeof config.verifyPanel.title !== "string") config.verifyPanel.title = defaultConfig.verifyPanel.title;
        if (typeof config.verifyPanel.description !== "string") config.verifyPanel.description = defaultConfig.verifyPanel.description;
        if (typeof config.verifyPanel.buttonLabel !== "string") config.verifyPanel.buttonLabel = defaultConfig.verifyPanel.buttonLabel;
        if (typeof config.verifyPanel.buttonEmoji !== "string") config.verifyPanel.buttonEmoji = defaultConfig.verifyPanel.buttonEmoji;

        config.categories = config.categories.map(category => {
            if (!category.id) category.id = makeId();
            if (typeof category.name !== "string") category.name = "Nowa kategoria";
            if (typeof category.emoji !== "string") category.emoji = "📁";
            if (typeof category.description !== "string") category.description = "";
            if (!Array.isArray(category.questions)) category.questions = [];
            return category;
        });

        return config;
    } catch (error) {
        console.error("❌ Błąd odczytu konfiguracji:", error);
        return JSON.parse(JSON.stringify(defaultConfig));
    }
}

let config = loadConfig();

// ==========================================================
// ZAPIS KONFIGURACJI
// ==========================================================

function saveConfig() {
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 4), "utf8");
        return true;
    } catch (error) {
        console.error("❌ Błąd zapisu konfiguracji:", error);
        return false;
    }
}

// ==========================================================
// POMOCNICZE
// ==========================================================

function makeId() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

function isAdmin(member) {
    if (!member) return false;
    return member.permissions?.has(PermissionsBitField.Flags.Administrator);
}

function isSupportOrAdmin(member) {
    if (!member) return false;
    if (isAdmin(member)) return true;
    return member.roles.cache.some(role => config.supportRoleIds.includes(role.id));
}

function getCategory(categoryId) {
    return config.categories.find(category => category.id === categoryId);
}

function safeChannelName(text) {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9ąćęłńóśźż_-]/gi, "-")
        .replace(/-+/g, "-")
        .substring(0, 70);
}

// ==========================================================
// PUBLICZNY PANEL TICKETÓW
// ==========================================================

function createTicketPanel() {
    const panel = config.ticketPanel || defaultConfig.ticketPanel;
    const title = panel.title || "\u200B";
    const description = panel.description || "\u200B";
    const placeholder = panel.placeholder || "📁 Wybierz kategorię";

    const embed = new EmbedBuilder()
        .setTitle(title.substring(0, 256))
        .setDescription(description.substring(0, 4096))
        .setColor(0x2ecc71);

    const options = config.categories.slice(0, 25).map(category => {
        const option = new StringSelectMenuOptionBuilder()
            .setLabel(category.name.substring(0, 100))
            .setValue(category.id)
            .setDescription((category.description || "Otwórz ticket").substring(0, 100));

        if (category.emoji) option.setEmoji(category.emoji);
        return option;
    });

    const menu = new StringSelectMenuBuilder()
        .setCustomId("ticket_category_select_public")
        .setPlaceholder(placeholder.substring(0, 150))
        .addOptions(options);

    const row = new ActionRowBuilder().addComponents(menu);

    return { embeds: [embed], components: [row] };
}

// ==========================================================
// PANEL WERYFIKACJI
// ==========================================================

function createVerifyPanel() {
    const panel = config.verifyPanel || defaultConfig.verifyPanel;
    const embed = new EmbedBuilder()
        .setTitle(panel.title.substring(0, 256))
        .setDescription(panel.description.substring(0, 4096))
        .setColor(0x00FF00)
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("verify_btn")
            .setLabel(panel.buttonLabel.substring(0, 80))
            .setStyle(ButtonStyle.Success)
            .setEmoji(panel.buttonEmoji || "✅")
    );

    return { embeds: [embed], components: [row] };
}

// ==========================================================
// PANEL ADMINISTRATORA TICKETÓW
// ==========================================================

function createAdminPanel() {
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("admin_ticket_panel").setLabel("📤 Wyślij Panel Ticket").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("admin_edit_panel").setLabel("✏️ Edytuj Panel Ticket").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("admin_categories").setLabel("📁 Kategorie").setStyle(ButtonStyle.Primary)
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("admin_questions").setLabel("❓ Pytania").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("admin_roles").setLabel("👥 Role obsługi").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("admin_ticket_category").setLabel("📂 Kategoria kanałów").setStyle(ButtonStyle.Secondary)
    );

    const row3 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("admin_transcripts").setLabel("📜 Ustaw Transkrypcje").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("admin_info").setLabel("ℹ️ Informacje").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("admin_close_panel").setLabel("❌ Zamknij").setStyle(ButtonStyle.Danger)
    );

    return [row1, row2, row3];
}

// ==========================================================
// MODALE ADMINA
// ==========================================================

function ticketPanelModal() {
    const modal = new ModalBuilder().setCustomId("ticket_panel_modal").setTitle("📝 Edytuj panel ticketów");

    const title = new TextInputBuilder()
        .setCustomId("panel_title")
        .setLabel("Tytuł panelu")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(256)
        .setValue(config.ticketPanel.title || "");

    const description = new TextInputBuilder()
        .setCustomId("panel_description")
        .setLabel("Opis panelu")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(4000)
        .setValue(config.ticketPanel.description || "");

    const placeholder = new TextInputBuilder()
        .setCustomId("panel_placeholder")
        .setLabel("Tekst rozwijanego menu")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(150)
        .setValue(config.ticketPanel.placeholder || "");

    modal.addComponents(
        new ActionRowBuilder().addComponents(title),
        new ActionRowBuilder().addComponents(description),
        new ActionRowBuilder().addComponents(placeholder)
    );

    return modal;
}

function verifyPanelModal() {
    const modal = new ModalBuilder().setCustomId("verify_panel_modal").setTitle("🔐 Edytuj panel weryfikacji");

    const title = new TextInputBuilder()
        .setCustomId("verify_title")
        .setLabel("Tytuł panelu weryfikacji")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(256)
        .setValue(config.verifyPanel.title || "");

    const description = new TextInputBuilder()
        .setCustomId("verify_description")
        .setLabel("Opis panelu weryfikacji")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(4000)
        .setValue(config.verifyPanel.description || "");

    const buttonLabel = new TextInputBuilder()
        .setCustomId("verify_btn_label")
        .setLabel("Tekst przycisku weryfikacji")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(80)
        .setValue(config.verifyPanel.buttonLabel || "");

    const buttonEmoji = new TextInputBuilder()
        .setCustomId("verify_btn_emoji")
        .setLabel("Emoji przycisku")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(20)
        .setValue(config.verifyPanel.buttonEmoji || "✅");

    modal.addComponents(
        new ActionRowBuilder().addComponents(title),
        new ActionRowBuilder().addComponents(description),
        new ActionRowBuilder().addComponents(buttonLabel),
        new ActionRowBuilder().addComponents(buttonEmoji)
    );

    return modal;
}

function addCategoryModal() {
    const modal = new ModalBuilder().setCustomId("category_add_modal").setTitle("📁 Dodaj kategorię");

    const name = new TextInputBuilder().setCustomId("category_name").setLabel("Nazwa kategorii").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100);
    const emoji = new TextInputBuilder().setCustomId("category_emoji").setLabel("Emotka kategorii").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100).setValue("📁");
    const description = new TextInputBuilder().setCustomId("category_description").setLabel("Opis kategorii").setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(100);

    modal.addComponents(
        new ActionRowBuilder().addComponents(name),
        new ActionRowBuilder().addComponents(emoji),
        new ActionRowBuilder().addComponents(description)
    );

    return modal;
}

function editCategoryModal(category) {
    const modal = new ModalBuilder().setCustomId(`category_edit_modal_${category.id}`).setTitle("✏️ Edytuj kategorię");

    const name = new TextInputBuilder().setCustomId("category_name").setLabel("Nazwa kategorii").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100).setValue(category.name.substring(0, 100));
    const emoji = new TextInputBuilder().setCustomId("category_emoji").setLabel("Emotka kategorii").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100).setValue(category.emoji || "📁");
    const description = new TextInputBuilder().setCustomId("category_description").setLabel("Opis kategorii").setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(100).setValue(category.description || "");

    modal.addComponents(
        new ActionRowBuilder().addComponents(name),
        new ActionRowBuilder().addComponents(emoji),
        new ActionRowBuilder().addComponents(description)
    );

    return modal;
}

function categoryAdminMenu(customId) {
    const options = config.categories.slice(0, 25).map(category => {
        const option = new StringSelectMenuOptionBuilder().setLabel(category.name.substring(0, 100)).setValue(category.id);
        if (category.emoji) option.setEmoji(category.emoji);
        return option;
    });

    const menu = new StringSelectMenuBuilder().setCustomId(customId).setPlaceholder("📁 Wybierz kategorię").addOptions(options);
    return new ActionRowBuilder().addComponents(menu);
}

function questionCategoryMenu(actionType) {
    const options = config.categories.slice(0, 25).map(category => {
        const option = new StringSelectMenuOptionBuilder().setLabel(category.name.substring(0, 100)).setValue(category.id);
        if (category.emoji) option.setEmoji(category.emoji);
        return option;
    });

    const menu = new StringSelectMenuBuilder().setCustomId(`q_cat_select_${actionType}`).setPlaceholder("❓ Wybierz kategorię").addOptions(options);
    return new ActionRowBuilder().addComponents(menu);
}

function questionSelectMenu(category, actionType) {
    const options = category.questions.slice(0, 25).map((q, index) => {
        return new StringSelectMenuOptionBuilder()
            .setLabel(`${index + 1}. ${q}`.substring(0, 100))
            .setValue(String(index));
    });

    const menu = new StringSelectMenuBuilder().setCustomId(`q_select_${actionType}_${category.id}`).setPlaceholder("❓ Wybierz pytanie").addOptions(options);
    return new ActionRowBuilder().addComponents(menu);
}

function addQuestionModal(categoryId) {
    const modal = new ModalBuilder().setCustomId(`question_add_modal_${categoryId}`).setTitle("❓ Dodaj pytanie");
    const question = new TextInputBuilder().setCustomId("question_text").setLabel("Treść pytania").setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(4000);

    modal.addComponents(new ActionRowBuilder().addComponents(question));
    return modal;
}

function editQuestionModal(categoryId, index, currentText) {
    const modal = new ModalBuilder().setCustomId(`question_edit_modal_${categoryId}_${index}`).setTitle("✏️ Edytuj pytanie");
    const question = new TextInputBuilder().setCustomId("question_text").setLabel("Nowa treść pytania").setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(4000).setValue(currentText);

    modal.addComponents(new ActionRowBuilder().addComponents(question));
    return modal;
}

function createTicketModal(category) {
    const questions = category.questions || [];
    const questionsToAsk = questions.slice(0, 5);

    const modal = new ModalBuilder().setCustomId(`ticket_questions_modal_${category.id}`).setTitle(category.name.substring(0, 45));

    questionsToAsk.forEach((question, index) => {
        const input = new TextInputBuilder()
            .setCustomId(`answer_${index}`)
            .setLabel(question.substring(0, 45))
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(1000);

        modal.addComponents(new ActionRowBuilder().addComponents(input));
    });

    return modal;
}

// ==========================================================
// TWORZENIE KANAŁU TICKETU
// ==========================================================

async function createTicketAfterForm(interaction, category, answers) {
    const guild = interaction.guild;
    if (!guild) return null;

    const existing = guild.channels.cache.find(channel => channel.topic === `ticket-owner:${interaction.user.id}`);
    if (existing) {
        return { error: `❌ Masz już otwarty ticket: ${existing}` };
    }

    const permissionOverwrites = [
        {
            id: guild.roles.everyone.id,
            deny: [PermissionsBitField.Flags.ViewChannel]
        },
        {
            id: interaction.user.id,
            allow: [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.ReadMessageHistory,
                PermissionsBitField.Flags.AttachFiles
            ]
        }
    ];

    for (const roleId of config.supportRoleIds) {
        const role = guild.roles.cache.get(roleId);
        if (role) {
            permissionOverwrites.push({
                id: role.id,
                allow: [
                    PermissionsBitField.Flags.ViewChannel,
                    PermissionsBitField.Flags.SendMessages,
                    PermissionsBitField.Flags.ReadMessageHistory,
                    PermissionsBitField.Flags.AttachFiles
                ]
            });
        }
    }

    const channelName = safeChannelName(`${category.name}-${interaction.user.username}`);
    const channelOptions = {
        name: `ticket-${channelName}`.substring(0, 100),
        type: ChannelType.GuildText,
        topic: `ticket-owner:${interaction.user.id}`,
        permissionOverwrites,
        reason: `Ticket utworzony przez ${interaction.user.tag}`
    };

    if (config.ticketCategoryId) {
        const parent = guild.channels.cache.get(config.ticketCategoryId);
        if (parent && parent.type === ChannelType.GuildCategory) {
            channelOptions.parent = parent.id;
        }
    }

    let channel;
    try {
        channel = await guild.channels.create(channelOptions);
    } catch (error) {
        console.error("❌ Błąd tworzenia ticketu:", error);
        return { error: "❌ Nie udało się utworzyć kanału ticketu." };
    }

    let supportMention = config.supportRoleIds.map(id => `<@&${id}>`).join(" ");

    const embed = new EmbedBuilder()
        .setTitle(`${category.emoji || "📁"} ${category.name}`)
        .setDescription(`Ticket utworzony przez ${interaction.user}\n\nKategoria: **${category.name}**`)
        .setColor(0x3498db)
        .setTimestamp();

    const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("ticket_claim").setLabel("🙋 Przejmij ticket").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("ticket_close").setLabel("🔒 Zamknij ticket").setStyle(ButtonStyle.Danger)
    );

    await channel.send({
        content: `${interaction.user} ${supportMention}`.trim(),
        embeds: [embed],
        components: [buttons]
    });

    let answersText = "📝 **ODPOWIEDZI Z FORMULARZA**\n\n";
    category.questions.slice(0, 5).forEach((question, index) => {
        const answer = answers[index] || "Brak odpowiedzi";
        answersText += `**${index + 1}. ${question}**\n${answer}\n\n`;
    });

    const answersEmbed = new EmbedBuilder()
        .setTitle("📝 Odpowiedzi do zgłoszenia")
        .setDescription(answersText.substring(0, 4096))
        .setColor(0x2ecc71)
        .setFooter({ text: `Ticket użytkownika ${interaction.user.tag}` })
        .setTimestamp();

    await channel.send({ embeds: [answersEmbed] });

    return { channel };
}

// ==========================================================
// TRANSKRYPCJA TXT
// ==========================================================

async function createTranscript(channel, closer) {
    let messages = [];
    let lastId;

    try {
        while (true) {
            const fetched = await channel.messages.fetch({
                limit: 100,
                ...(lastId ? { before: lastId } : {})
            });

            if (fetched.size === 0) break;
            messages.push(...fetched.values());
            lastId = fetched.last().id;
            if (fetched.size < 100) break;
        }
    } catch (error) {
        console.error("Błąd generowania transkrypcji:", error);
    }

    messages.reverse();

    let text = `TRANSKRYPCJA KANAŁU: #${channel.name}\n`;
    text += `Serwer: ${channel.guild.name}\n`;
    text += `Data: ${new Date().toISOString()}\n`;
    text += `Zamknięte przez: ${closer.tag}\n`;
    text += "=".repeat(50) + "\n\n";

    for (const msg of messages) {
        const time = msg.createdAt.toISOString();
        text += `[${time}] ${msg.author.tag}: ${msg.content}\n`;
        if (msg.embeds.length > 0) {
            text += `[EMBEDY]: ${msg.embeds.map(e => e.title || e.description || "").join(" | ")}\n`;
        }
    }

    const buffer = Buffer.from(text, "utf8");
    return new AttachmentBuilder(buffer, { name: `transcript-${channel.name}.txt` });
}

// ==========================================================
// ZDARZENIA BOTA
// ==========================================================

client.once("ready", async () => {
    console.log(`✅ Zalogowano jako ${client.user.tag}!`);

    const commands = [
        {
            name: "weryfikacja",
            description: "Ustawia rolę po weryfikacji oraz wysyła panel weryfikacyjny.",
            options: [
                {
                    name: "rola",
                    type: 8, // Role
                    description: "Rola nadawana po zweryfikowaniu",
                    required: true
                }
            ],
            default_member_permissions: PermissionsBitField.Flags.Administrator.toString()
        },
        {
            name: "weryfikacja-edycja",
            description: "Otwiera modal edycji wyglądu panelu weryfikacji",
            default_member_permissions: PermissionsBitField.Flags.Administrator.toString()
        },
        {
            name: "transkrypcja-ustaw",
            description: "Ustawia kanał, na który będą wysyłane transkrypcje zamkniętych ticketów.",
            options: [
                {
                    name: "kanal",
                    type: 7, // Channel
                    description: "Wybierz kanał tekstowy",
                    required: true,
                    channel_types: [ChannelType.GuildText]
                }
            ],
            default_member_permissions: PermissionsBitField.Flags.Administrator.toString()
        },
        {
            name: "ticket",
            description: "Otwiera panel zarządzania systemem ticketów",
            default_member_permissions: PermissionsBitField.Flags.Administrator.toString()
        }
    ];

    try {
        await client.application.commands.set(commands);
        console.log("✅ Rejestracja komend slash zakończona.");
    } catch (error) {
        console.error("❌ Błąd rejestracji komend:", error);
    }
});

// Automatyczna rola Niezweryfikowany po wejściu
client.on("guildMemberAdd", async member => {
    try {
        const unverifiedRole = member.guild.roles.cache.find(role => role.name === "Niezweryfikowany");
        if (unverifiedRole) {
            await member.roles.add(unverifiedRole);
            console.log(`Nadano rolę "Niezweryfikowany" użytkownikowi ${member.user.tag}`);
        }
    } catch (error) {
        console.error(`Błąd przy nadawaniu roli Niezweryfikowany dla ${member.user.tag}:`, error);
    }
});

// Czyszczenie mapy przejęć po usunięciu kanału
client.on("channelDelete", channel => {
    if (claimedTickets.has(channel.id)) {
        claimedTickets.delete(channel.id);
    }
});

// ==========================================================
// OBSŁUGA INTERAKCJI
// ==========================================================

client.on("interactionCreate", async interaction => {
    try {
        // --- KOMENDY SLASH ---
        if (interaction.isChatInputCommand()) {
            if (interaction.commandName === "weryfikacja") {
                if (!isAdmin(interaction.member)) {
                    return await interaction.reply({ content: "❌ Brak uprawnień administratora.", ephemeral: true });
                }

                const targetRole = interaction.options.getRole("rola");
                config.verifiedRoleId = targetRole.id;
                saveConfig();

                await interaction.channel.send(createVerifyPanel());
                await interaction.reply({ content: `✅ Ustawiono rolę weryfikacyjną na **${targetRole.name}** i wysłano panel!`, ephemeral: true });
            }
            else if (interaction.commandName === "weryfikacja-edycja") {
                if (!isAdmin(interaction.member)) {
                    return await interaction.reply({ content: "❌ Brak uprawnień administratora.", ephemeral: true });
                }
                await interaction.showModal(verifyPanelModal());
            }
            else if (interaction.commandName === "transkrypcja-ustaw") {
                if (!isAdmin(interaction.member)) {
                    return await interaction.reply({ content: "❌ Brak uprawnień administratora.", ephemeral: true });
                }

                const channel = interaction.options.getChannel("kanal");
                config.transcriptChannelId = channel.id;
                saveConfig();

                await interaction.reply({ content: `✅ Ustawiono kanał transkrypcji na: ${channel}`, ephemeral: true });
            }
            else if (interaction.commandName === "ticket") {
                if (!isAdmin(interaction.member)) {
                    return await interaction.reply({ content: "❌ Brak uprawnień administratora.", ephemeral: true });
                }

                await interaction.reply({
                    content: "⚙️ **Panel zarządzania systemem ticketów:**",
                    components: createAdminPanel(),
                    ephemeral: true
                });
            }
        }

        // --- PRZYCISKI ---
        else if (interaction.isButton()) {
            if (interaction.customId === "verify_btn") {
                await interaction.deferReply({ ephemeral: true });

                if (!config.verifiedRoleId) {
                    return await interaction.editReply({ content: "❌ Rola weryfikacyjna nie została jeszcze skonfigurowana." });
                }

                const member = interaction.member;
                const guild = interaction.guild;

                const unverifiedRole = guild.roles.cache.find(role => role.name === "Niezweryfikowany");
                const verifiedRole = guild.roles.cache.get(config.verifiedRoleId);

                if (!verifiedRole) {
                    return await interaction.editReply({ content: "❌ Skonfigurowana rola weryfikacji nie istnieje na serwerze." });
                }

                try {
                    if (unverifiedRole && member.roles.cache.has(unverifiedRole.id)) {
                        await member.roles.remove(unverifiedRole);
                    }
                    if (!member.roles.cache.has(verifiedRole.id)) {
                        await member.roles.add(verifiedRole);
                    }

                    await interaction.editReply({ content: "🎉 Twoje konto zostało pomyślnie zweryfikowane!" });
                } catch (error) {
                    console.error("Błąd nadawania roli weryfikacyjnej:", error);
                    await interaction.editReply({ content: "❌ Wystąpił błąd podczas nadawania ról." });
                }
            }
            else if (interaction.customId === "admin_ticket_panel") {
                if (!isAdmin(interaction.member)) return;
                const panelData = createTicketPanel();
                await interaction.channel.send(panelData);
                await interaction.reply({ content: "✅ Wysyłano publiczny panel ticketów na obecny kanał!", ephemeral: true });
            }
            else if (interaction.customId === "admin_edit_panel") {
                if (!isAdmin(interaction.member)) return;
                await interaction.showModal(ticketPanelModal());
            }
            else if (interaction.customId === "admin_categories") {
                if (!isAdmin(interaction.member)) return;
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId("cat_add").setLabel("➕ Dodaj").setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId("cat_edit").setLabel("✏️ Edytuj").setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId("cat_del").setLabel("🗑️ Usuń").setStyle(ButtonStyle.Danger)
                );
                await interaction.reply({ content: "📁 Zarządzanie kategoriami ticketów:", components: [row], ephemeral: true });
            }
            else if (interaction.customId === "cat_add") {
                if (!isAdmin(interaction.member)) return;
                await interaction.showModal(addCategoryModal());
            }
            else if (interaction.customId === "cat_edit") {
                if (!isAdmin(interaction.member)) return;
                await interaction.reply({ content: "Wybierz kategorię do edycji:", components: [categoryAdminMenu("cat_edit_select")], ephemeral: true });
            }
            else if (interaction.customId === "cat_del") {
                if (!isAdmin(interaction.member)) return;
                await interaction.reply({ content: "Wybierz kategorię do usunięcia:", components: [categoryAdminMenu("cat_del_select")], ephemeral: true });
            }
            else if (interaction.customId === "admin_questions") {
                if (!isAdmin(interaction.member)) return;
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId("q_add").setLabel("➕ Dodaj pytanie").setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId("q_edit").setLabel("✏️ Edytuj pytanie").setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId("q_del").setLabel("🗑️ Usuń pytanie").setStyle(ButtonStyle.Danger)
                );
                await interaction.reply({ content: "❓ Zarządzanie pytaniami w formularzu ticketów:", components: [row], ephemeral: true });
            }
            else if (interaction.customId === "q_add") {
                if (!isAdmin(interaction.member)) return;
                await interaction.reply({ content: "Wybierz kategorię, do której chcesz **dodać** pytanie:", components: [questionCategoryMenu("add")], ephemeral: true });
            }
            else if (interaction.customId === "q_edit") {
                if (!isAdmin(interaction.member)) return;
                await interaction.reply({ content: "Wybierz kategorię, z której chcesz **edytować** pytanie:", components: [questionCategoryMenu("edit")], ephemeral: true });
            }
            else if (interaction.customId === "q_del") {
                if (!isAdmin(interaction.member)) return;
                await interaction.reply({ content: "Wybierz kategorię, z której chcesz **usunąć** pytanie:", components: [questionCategoryMenu("del")], ephemeral: true });
            }
            else if (interaction.customId === "admin_roles") {
                if (!isAdmin(interaction.member)) return;

                const roleSelect = new RoleSelectMenuBuilder()
                    .setCustomId("support_role_select")
                    .setPlaceholder("👥 Wybierz rolę do dodania/usunięcia z obsługi");

                const row = new ActionRowBuilder().addComponents(roleSelect);

                const currentRolesList = config.supportRoleIds.map(id => `<@&${id}>`).join(", ") || "Brak";

                await interaction.reply({
                    content: `👥 **Aktualne role obsługi ticketów:** ${currentRolesList}\n\nWybierz rolę poniżej, aby ją dodać lub usunąć:`,
                    components: [row],
                    ephemeral: true
                });
            }
            else if (interaction.customId === "admin_ticket_category") {
                if (!isAdmin(interaction.member)) return;
                await interaction.reply({ content: `Ustawiona kategoria kanałów ID: ${config.ticketCategoryId || "Brak"}`, ephemeral: true });
            }
            else if (interaction.customId === "admin_transcripts") {
                if (!isAdmin(interaction.member)) return;

                const channelSelect = new ChannelSelectMenuBuilder()
                    .setCustomId("transcript_channel_select")
                    .setPlaceholder("📜 Wybierz kanał dla transkrypcji")
                    .setChannelTypes(ChannelType.GuildText);

                const row = new ActionRowBuilder().addComponents(channelSelect);

                await interaction.reply({
                    content: `Aktualny kanał transkrypcji: ${config.transcriptChannelId ? `<#${config.transcriptChannelId}>` : "Brak"}\n\nWybierz nowy kanał poniżej:`,
                    components: [row],
                    ephemeral: true
                });
            }
            else if (interaction.customId === "admin_info") {
                if (!isAdmin(interaction.member)) return;
                await interaction.reply({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle("ℹ️ Stan Konfiguracji")
                            .setDescription(`Liczba kategorii ticketów: **${config.categories.length}**\nLiczba ról obsługi: **${config.supportRoleIds.length}**\nRola zweryfikowana: ${config.verifiedRoleId ? `<@&${config.verifiedRoleId}>` : "Brak"}\nKanał transkrypcji: ${config.transcriptChannelId ? `<#${config.transcriptChannelId}>` : "Brak"}`)
                            .setColor(0x3498db)
                    ],
                    ephemeral: true
                });
            }
            else if (interaction.customId === "admin_close_panel") {
                if (!isAdmin(interaction.member)) return;
                await interaction.message.delete().catch(() => {});
            }
            else if (interaction.customId === "ticket_claim") {
                if (!isSupportOrAdmin(interaction.member)) {
                    return await interaction.reply({ content: "❌ Nie masz uprawnień do przejęcia tego ticketu.", ephemeral: true });
                }

                // SPRAWDZENIE CZY TICKET JEST JUŻ PRZEJĘTY
                if (claimedTickets.has(interaction.channel.id)) {
                    const claimedUserId = claimedTickets.get(interaction.channel.id);
                    return await interaction.reply({
                        content: `⚠️ Ten ticket został już przejęty przez <@${claimedUserId}>!`,
                        ephemeral: true
                    });
                }

                // ZAPISANIE PRZEJĘCIA TICKETU
                claimedTickets.set(interaction.channel.id, interaction.user.id);

                // ELEGANCKI, CIEMNY EMBED PO PRZYJĘCIU TICKETU (CZARNY PASEK BOCZNY 0x2F3136)
                const claimEmbed = new EmbedBuilder()
                    .setTitle("👔 Zgłoszenie Przyjęte")
                    .setDescription(`Twój ticket został oficjalnie przyjęty do obsługi przez ${interaction.user}.\nOd tej pory ta osoba zajmuje się Twoim zgłoszeniem. Prosimy o cierpliwość!`)
                    .setColor(0x2F3136)
                    .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
                    .setFooter({ text: `Obsługa zgłoszenia: ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL() })
                    .setTimestamp();

                await interaction.reply({ embeds: [claimEmbed] });
            }
            else if (interaction.customId === "ticket_close") {
                if (!isSupportOrAdmin(interaction.member)) {
                    return await interaction.reply({ content: "❌ Tylko administracja lub członkowie obsługi mogą zamknąć ten ticket.", ephemeral: true });
                }

                await interaction.reply({ content: "🔒 Zamykanie ticketu i generowanie transkrypcji..." });
                const attachment = await createTranscript(interaction.channel, interaction.user);

                if (config.transcriptChannelId) {
                    const transChannel = interaction.guild.channels.cache.get(config.transcriptChannelId);
                    if (transChannel) {
                        await transChannel.send({
                            content: `📜 Transkrypcja z zamkniętego ticketu #${interaction.channel.name}:`,
                            files: [attachment]
                        }).catch(() => {});
                    }
                }

                setTimeout(async () => {
                    claimedTickets.delete(interaction.channel.id);
                    await interaction.channel.delete().catch(() => {});
                }, 4000);
            }
        }

        // --- SELECT MENU ---
        else if (interaction.isRoleSelectMenu()) {
            if (interaction.customId === "support_role_select") {
                const selectedRoleId = interaction.values[0];

                if (config.supportRoleIds.includes(selectedRoleId)) {
                    config.supportRoleIds = config.supportRoleIds.filter(id => id !== selectedRoleId);
                    saveConfig();
                    await interaction.update({ content: `🗑️ Usunięto rolę <@&${selectedRoleId}> z ról obsługi ticketów.`, components: [] });
                } else {
                    config.supportRoleIds.push(selectedRoleId);
                    saveConfig();
                    await interaction.update({ content: `✅ Dodano rolę <@&${selectedRoleId}> do ról obsługi ticketów.`, components: [] });
                }
            }
        }
        else if (interaction.isChannelSelectMenu()) {
            if (interaction.customId === "transcript_channel_select") {
                const selectedChannelId = interaction.values[0];
                config.transcriptChannelId = selectedChannelId;
                saveConfig();
                await interaction.update({
                    content: `✅ Pomyślnie zmieniono kanał transkrypcji na: <#${selectedChannelId}>`,
                    components: []
                });
            }
        }
        else if (interaction.isStringSelectMenu()) {
            if (interaction.customId === "ticket_category_select_public") {
                const category = getCategory(interaction.values[0]);
                if (!category) return await interaction.reply({ content: "❌ Kategoria nie istnieje.", ephemeral: true });

                if (category.questions && category.questions.length > 0) {
                    await interaction.showModal(createTicketModal(category));
                } else {
                    await interaction.deferReply({ ephemeral: true });
                    const res = await createTicketAfterForm(interaction, category, []);
                    if (res?.error) return await interaction.editReply({ content: res.error });
                    await interaction.editReply({ content: `✅ Stworzono ticket: ${res.channel}` });
                }
            }
            else if (interaction.customId === "cat_edit_select") {
                const category = getCategory(interaction.values[0]);
                if (category) await interaction.showModal(editCategoryModal(category));
            }
            else if (interaction.customId === "cat_del_select") {
                const catId = interaction.values[0];
                config.categories = config.categories.filter(c => c.id !== catId);
                saveConfig();
                await interaction.update({ content: "🗑️ Pomyślnie usunięto wybraną kategorię!", components: [] });
            }
            else if (interaction.customId === "q_cat_select_add") {
                const catId = interaction.values[0];
                await interaction.showModal(addQuestionModal(catId));
            }
            else if (interaction.customId === "q_cat_select_edit") {
                const category = getCategory(interaction.values[0]);
                if (!category || category.questions.length === 0) {
                    return await interaction.update({ content: "❌ Ta kategoria nie ma żadnych pytań do edycji.", components: [] });
                }
                await interaction.update({ content: `Wybierz pytanie z kategorii **${category.name}** do edycji:`, components: [questionSelectMenu(category, "edit")] });
            }
            else if (interaction.customId === "q_cat_select_del") {
                const category = getCategory(interaction.values[0]);
                if (!category || category.questions.length === 0) {
                    return await interaction.update({ content: "❌ Ta kategoria nie ma żadnych pytań do usunięcia.", components: [] });
                }
                await interaction.update({ content: `Wybierz pytanie z kategorii **${category.name}** do usunięcia:`, components: [questionSelectMenu(category, "del")] });
            }
            else if (interaction.customId.startsWith("q_select_edit_")) {
                const catId = interaction.customId.replace("q_select_edit_", "");
                const qIndex = parseInt(interaction.values[0]);
                const category = getCategory(catId);
                if (category && category.questions[qIndex] !== undefined) {
                    await interaction.showModal(editQuestionModal(catId, qIndex, category.questions[qIndex]));
                }
            }
            else if (interaction.customId.startsWith("q_select_del_")) {
                const catId = interaction.customId.replace("q_select_del_", "");
                const qIndex = parseInt(interaction.values[0]);
                const category = getCategory(catId);
                if (category) {
                    const removed = category.questions.splice(qIndex, 1);
                    saveConfig();
                    await interaction.update({ content: `🗑️ Pomyślnie usunięto pytanie: *"${removed}"*`, components: [] });
                }
            }
        }

        // --- MODALE SUBMIT ---
        else if (interaction.isModalSubmit()) {
            if (interaction.customId === "ticket_panel_modal") {
                config.ticketPanel.title = interaction.fields.getTextInputValue("panel_title");
                config.ticketPanel.description = interaction.fields.getTextInputValue("panel_description");
                config.ticketPanel.placeholder = interaction.fields.getTextInputValue("panel_placeholder");
                saveConfig();
                await interaction.reply({ content: "✅ Zaktualizowano wygląd panelu ticketów w konfiguracji!", ephemeral: true });
            }
            else if (interaction.customId === "verify_panel_modal") {
                config.verifyPanel.title = interaction.fields.getTextInputValue("verify_title");
                config.verifyPanel.description = interaction.fields.getTextInputValue("verify_description");
                config.verifyPanel.buttonLabel = interaction.fields.getTextInputValue("verify_btn_label");
                config.verifyPanel.buttonEmoji = interaction.fields.getTextInputValue("verify_btn_emoji");
                saveConfig();
                await interaction.reply({ content: "✅ Zaktualizowano wygląd panelu weryfikacji w konfiguracji!", ephemeral: true });
            }
            else if (interaction.customId === "category_add_modal") {
                config.categories.push({
                    id: makeId(),
                    name: interaction.fields.getTextInputValue("category_name"),
                    emoji: interaction.fields.getTextInputValue("category_emoji"),
                    description: interaction.fields.getTextInputValue("category_description"),
                    questions: []
                });
                saveConfig();
                await interaction.reply({ content: "✅ Pomyślnie dodano nową kategorię!", ephemeral: true });
            }
            else if (interaction.customId.startsWith("category_edit_modal_")) {
                const catId = interaction.customId.replace("category_edit_modal_", "");
                const category = getCategory(catId);
                if (category) {
                    category.name = interaction.fields.getTextInputValue("category_name");
                    category.emoji = interaction.fields.getTextInputValue("category_emoji");
                    category.description = interaction.fields.getTextInputValue("category_description");
                    saveConfig();
                    await interaction.reply({ content: "✅ Edycja kategorii zakończona!", ephemeral: true });
                }
            }
            else if (interaction.customId.startsWith("question_add_modal_")) {
                const catId = interaction.customId.replace("question_add_modal_", "");
                const category = getCategory(catId);
                if (category) {
                    category.questions.push(interaction.fields.getTextInputValue("question_text"));
                    saveConfig();
                    await interaction.reply({ content: "✅ Dodano pytanie do wybranej kategorii!", ephemeral: true });
                }
            }
            else if (interaction.customId.startsWith("question_edit_modal_")) {
                const parts = interaction.customId.replace("question_edit_modal_", "").split("_");
                const catId = parts[0];
                const qIndex = parseInt(parts[1]);
                const category = getCategory(catId);
                if (category && category.questions[qIndex] !== undefined) {
                    category.questions[qIndex] = interaction.fields.getTextInputValue("question_text");
                    saveConfig();
                    await interaction.reply({ content: "✅ Pomyślnie zaktualizowano treść pytania!", ephemeral: true });
                }
            }
            else if (interaction.customId.startsWith("ticket_questions_modal_")) {
                const catId = interaction.customId.replace("ticket_questions_modal_", "");
                const category = getCategory(catId);
                if (!category) return await interaction.reply({ content: "❌ Błąd kategorii.", ephemeral: true });

                const answers = [];
                category.questions.slice(0, 5).forEach((_, idx) => {
                    answers.push(interaction.fields.getTextInputValue(`answer_${idx}`));
                });

                await interaction.deferReply({ ephemeral: true });
                const res = await createTicketAfterForm(interaction, category, answers);
                if (res?.error) return await interaction.editReply({ content: res.error });
                await interaction.editReply({ content: `✅ Pomyślnie utworzono Twój ticket: ${res.channel}` });
            }
        }
    } catch (error) {
        console.error("❌ Błąd interakcji:", error);
        if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: "Wystąpił błąd podczas wykonywania tej akcji.", ephemeral: true }).catch(() => {});
        }
    }
});

// ==========================================================
// URUCHOMIENIE BOTA
// ==========================================================

client.login(TOKEN);
