const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const axios = require('axios');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('pokeguess')
		.setDescription('Start a pokemon guessing game!'),
	async execute(interaction) {
        const user = interaction.user;
        const member = interaction.guild.members.cache.get(user.id);
        const baseURL = "https://pokeapi.co/api/v2/pokemon/";

        // gen 1 pokemon!
        const min = 1;
        const max = 151;

        const randNum = Math.floor(Math.random() * max + min);

        try {
            const response = await axios.get(`${baseURL}${randNum}`);
            const pokemon = response.data.name;

            const embed = new EmbedBuilder()
                .setTitle(`What pokemon is this?`)
                .setDescription(`*Generation I*`)
                .setColor('DarkVividPink')
                .setFooter({ text: `Requested by ${member.displayName}`, iconURL: `${user.displayAvatarURL()}`})
                .setImage(`https://play.pokemonshowdown.com/sprites/ani/${pokemon}.gif`);

            await interaction.reply({ embeds: [embed] });
        } catch (error) {
            console.error(error);
            await interaction.reply('An error occurred while fetching the Pokémon.');
        }
    },
};