import parse from "csv-parse/lib/sync";
import path from "path";
import { mapValues, chain, merge, sum } from "lodash";
import dotenv from "dotenv";
import got from "got";
import { default as fsCallbacks } from "fs";
const fs = fsCallbacks.promises;

dotenv.config();

interface Transaction {
  kind: string;
  asset: string;
  quantity: number;
  price: number;
}

interface Wallet {
  [key: string]: {
    total: number;
    purchases: number[];
    costBasis: number;
  };
}

interface CoinMarketCapResponse {
  data: {
    [key: string]: {
      quote: {
        USD: {
          price: number;
        };
      };
    };
  };
}

interface Prices {
  [key: string]: number;
}

const getPrices = async (currencies: string[]): Promise<Prices> => {
  try {
    const url = `https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?symbol=${currencies.join(
      ","
    )}`;
    const data: CoinMarketCapResponse = await got(url, {
      headers: {
        "X-CMC_PRO_API_KEY": process.env.COIN_MARKET_CAP_API_KEY!,
      },
    }).json();

    return mapValues(data.data, (currency) => currency.quote.USD.price);
  } catch (err) {
    console.log(err);
    return {} as Prices;
  }
};

(async () => {
  // Download transaction data from https://www.coinbase.com/reports
  const content = await fs.readFile(path.join(__dirname, "../data.csv"));
  const records = parse(content);

  const wallet = chain(records)
    .drop(1)
    .map(
      ([_, kind, asset, quantity, __, price]) =>
        ({
          kind,
          asset,
          quantity: Number(quantity),
          price: Number(price),
        } as Transaction)
    )
    .filter((transaction) => transaction.kind === "Buy")
    .reduce((wallet, transaction) => {
      const asset = merge(
        {
          total: 0,
          purchases: [],
          costBasis: 0,
        },
        wallet[transaction.asset]
      );

      asset.total += transaction.quantity;
      asset.purchases.push(transaction.price);
      asset.costBasis = sum(asset.purchases) / asset.purchases.length;

      wallet[transaction.asset] = asset;
      return wallet;
    }, {} as Wallet)
    .value();

  const prices = await getPrices(Object.keys(wallet));

  console.log("HODLing...");
  console.table(
    Object.keys(wallet).map((currency) => {
      const price = prices[currency];
      const amount = wallet[currency].total;
      const costBasis = wallet[currency].costBasis;
      const percentChange = ((price - costBasis) / costBasis) * 100;
      const gainOrLoss = percentChange > 0 ? "📈" : "📉";

      return {
        currency,
        price: price.toFixed(2),
        amount: amount.toFixed(6),
        basis: costBasis.toFixed(2),
        cost: `$${(amount * costBasis).toFixed(2)}`,
        value: `$${(amount * price).toFixed(2)}`,
        change: `${gainOrLoss} ${percentChange.toFixed(2)}%`,
      };
    })
  );
})();
