const { SlashCommandBuilder, EmbedBuilder, CommandInteractionOptionResolver } = require('discord.js');
const axios = require('axios');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('pokeguess')
		.setDescription('Start a pokemon guessing game!')
        .addIntegerOption(option =>
			option.setName('generation')
				.setDescription('Pulls from a specific pokemon generation (1-7)')
                .setMinValue(1)
                .setMaxValue(7)),
	async execute(interaction) {

        const user = interaction.user;
        const member = interaction.guild.members.cache.get(user.id);
        const baseURL = "https://pokeapi.co/api/v2/pokemon/";

        const generationInfo = {
            1: ['I', 1, 151],
            2: ['II', 152, 251],
            3: ['III', 252, 386],
            4: ['IV', 387, 493],
            5: ['V', 494, 649],
            6: ['VI', 650, 721],
            7: ['VII', 722, 809],
        };

        const gen = parseInt(interaction.options.getInteger('generation') ?? 1);
        const genInfo = generationInfo[gen];

        const min = genInfo[1];
        const span = genInfo[2] - genInfo[1];

        const randNum = Math.floor(Math.random() * span + min);

        // console.log(`gen is ${gen}, min is ${min}, max is ${generationInfo[gen][2]}, rand is ${randNum}`);

        try {
            const response = await axios.get(`${baseURL}${randNum}`);
            let pokemon = response.data.name;

            //remove dashes (for multiple form pokemon, as pokemon showdown doesnt have those)
            const index = pokemon.indexOf("-");
            if (index !== -1) {
                pokemon = pokemon.substring(0, index);
            }

            const filter = m => !m.author.bot;
            const collector = interaction.channel.createMessageCollector({
                filter, 
                time: 15000, 
            });

            const embed = new EmbedBuilder()
                .setTitle(`Who's that pokemon?`)
                .setDescription(`*Generation ${genInfo[0]}*`)
                .setColor('DarkVividPink')
                .setFooter({ text: `Requested by ${member.displayName}`, iconURL: `${user.displayAvatarURL()}`})
                .setImage(`https://play.pokemonshowdown.com/sprites/ani/${pokemon}.gif`);

            const sentMessage = await interaction.reply({ embeds: [embed] });
            const messageID = sentMessage.id;

            collector.on('collect', async (m) => {
                const guess = m.content.toLowerCase();
                const username = m.member.nickname || m.author.username;

                if (guess === pokemon) {
                    const modifiedEmbed = new EmbedBuilder()
                        .setTitle(`Correct! That's ${pokemon}!`)
                        .setDescription(`*${username} got it right!*`)
                        .setColor('Green')
                        .setFooter({ text: `Requested by ${member.displayName}`, iconURL: `${user.displayAvatarURL()}`})
                        .setImage(`https://play.pokemonshowdown.com/sprites/ani/${pokemon}.gif`);
                        
                    await sentMessage.edit({ embeds: [modifiedEmbed] });
                    // await interaction.followUp(`You guessed it! The Pokémon was ${pokemon}.`);
                } else {
                    const modifiedEmbed = new EmbedBuilder()
                        .setTitle(`Incorrect. That's ${pokemon}!`)
                        .setDescription(`*${username} said "${guess}"*`)
                        .setColor('Red')
                        .setFooter({ text: `Requested by ${member.displayName}`, iconURL: `${user.displayAvatarURL()}`})
                        .setImage(`https://play.pokemonshowdown.com/sprites/ani/${pokemon}.gif`);
                        
                    await sentMessage.edit({ embeds: [modifiedEmbed] });
                    // await interaction.followUp(`Sorry, that's not the right Pokémon.`);
                }
                // console.log(`${guess} is the guess, which is not ${pokemon}`);
                collector.stop();
            });

            collector.on('end', async (collected, reason) => {
                if (reason === 'time') {
                    const modifiedEmbed = new EmbedBuilder()
                        .setTitle(`Time's up. That's ${pokemon}!`)
                        .setDescription(`*Don't worry! You'll get it next time.*`)
                        .setColor('Greyple')
                        .setFooter({ text: `Requested by ${member.displayName}`, iconURL: `${user.displayAvatarURL()}`})
                        .setImage(`https://play.pokemonshowdown.com/sprites/ani/${pokemon}.gif`);
                        
                    await sentMessage.edit({ embeds: [modifiedEmbed] });
                }
            });

            } catch (error) {
                console.error(error);
                await interaction.reply('An error occurred while fetching the Pokémon.');
            }
    },
};