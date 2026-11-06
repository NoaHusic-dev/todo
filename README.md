# TODO

Web-aplikacija za zadatke i bilješke s opcionalnim rokovima, kalendarom i automatskim sortiranjem zadataka po prioritetu. Statičke stranice poslužuju se putem GitHub Pagesa, a prijava i sinkronizacija koriste Firebase Authentication i Cloud Firestore.

Za spremanje rokova objavi ažurirana Firestore pravila:

```sh
firebase deploy --only firestore:rules --project todo-2fff8
```
