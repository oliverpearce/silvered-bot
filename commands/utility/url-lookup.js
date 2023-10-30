// using rapidApi (https://rapidapi.com/hub)

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const axios = require('axios');
require('dotenv').config();
RAPID = process.env.RAPID_TOKEN;

module.exports = {
    data: new SlashCommandBuilder() 
        .setName('url-lookup')
        .setDescription('extract info from a url')
        .addStringOption(option => option.setName('url').setDescription('url you want to look up').setRequired(true)),
    async execute (interaction) {

        await interaction.deferReply({ ephemeral: false });

        // get url and options
        const {options} = interaction;
        const url = options.getString('url');

        const input = {
            method: 'GET',
            url: 'https://url-lookup-by-api-ninjas.p.rapidapi.com/v1/urllookup',
            params: {
                url: url
            },
            headers: {
                'X-RapidAPI-Key': RAPID,
                'X-RapidAPI-Host': 'url-lookup-by-api-ninjas.p.rapidapi.com'
            },
        };

        try {
            const output = await axios.request(input);

            const embed = new EmbedBuilder()
                .setColor('LuminousVividPink')
                .setTitle(`information on ${url}`)
                .setDescription(`\n> Country: \`${output.data.country} (${output.data.country_code})\` \n> Region: \`${output.data.region} (${output.data.region_code})\` \n> City: \`${output.data.city}\` \n> Zip Code: \`${output.data.zip}\` \n> Location: \`(${output.data.lat},${output.data.lon})\` \n> Timezone: \`${output.data.timezone}\` \n> ISP: \`${output.data.isp}\` \n`);
            
            // console.log(output.data);
            await interaction.editReply({ embeds: [embed]});
        } catch (e) {
            return await interaction.editReply({ content: 'something went wrong! sorry :('})
        }

    }

}