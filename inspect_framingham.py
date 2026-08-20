import pandas as pd
df = pd.read_csv('data/framingham.csv')
print(df.columns.tolist())
print(df.shape)
print(df.head(3))
