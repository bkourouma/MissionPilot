import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Squelette } from "../../../../components/ui/Squelette";
import { aPermission, creerTraduire, type Langue, type Traduire } from "@missionpilot/shared";
import { BadgePaiement } from "../../../../components/finance/BadgePaiement";
import { classesBouton } from "../../../../components/ui/Bouton";
import { Carte } from "../../../../components/ui/Carte";
import { Champ } from "../../../../components/ui/Champ";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide } from "../../../../components/ui/EtatListe";
import { Icone } from "../../../../components/ui/Icone";
import { Select } from "../../../../components/ui/Select";
import { Tableau, type ColonneTableau } from "../../../../components/ui/Tableau";
import { chargerServeur, type Chargement } from "../../../../lib/api-serveur";
import {
  BASE_LIBELLES,
  BASE_LIBELLES_EN,
  libelleTranche,
  lireFiltresBalance,
  requeteBalance,
  TRANCHES,
  type BalanceAgee,
  type LigneBalanceClient,
  type ParametresRelances as Parametres,
  type ValeursBalance,
} from "../../../../lib/creances";
import type { Creance } from "../../../../lib/encaissements";
import {
  formaterDate,
  formaterMontantMineur,
  type Devise,
  libelleDevise,
} from "../../../../lib/format";
import { obtenirLangue, obtenirT } from "../../../../lib/i18n/serveur";
import {
  formaterDelai,
  requeteIndicateurs,
  statutDelai,
  type ReponseIndicateurs,
} from "../../../../lib/indicateurs";
import { aujourdhui, debutDAnnee } from "../../../../lib/periode";
import { obtenirSession } from "../../../../lib/session";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { ParametresRelances } from "./ParametresRelances";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Créances", "Receivables") };
}

function colonnesBalance(devise: Devise, langue: Langue): ColonneTableau<LigneBalanceClient>[] {
  const t = creerTraduire(langue);
  return [
    {
      cle: "client",
      entete: t("Client", "Client"),
      rendu: (l) => l.raison_sociale ?? t("Client", "Client"),
    },
    ...TRANCHES.map((tr) => ({
      cle: tr.cle,
      entete: libelleTranche(tr.cle, langue),
      alignement: "droite" as const,
      rendu: (l: ValeursBalance) => (
        <span
          className={
            (tr.cle === "j61_90" || tr.cle === "plus_90") && l[tr.cle] > 0
              ? "mp-montant mp-montant--retard"
              : "mp-montant"
          }
        >
          {formaterMontantMineur(l[tr.cle], devise, langue)}
        </span>
      ),
    })),
    {
      cle: "total",
      entete: t("Total dû", "Total due"),
      alignement: "droite",
      rendu: (l) => (
        <strong className="mp-montant">{formaterMontantMineur(l.total, devise, langue)}</strong>
      ),
    },
  ];
}

export default async function PageCreances({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { utilisateur } = await obtenirSession();
  const langue = await obtenirLangue();
  const t = creerTraduire(langue);
  const roles = utilisateur.roles;
  const gerer = aPermission(roles, "encaissement.gerer");
  const indicateurs = aPermission(roles, "indicateurs.cabinet");
  // Mêmes droits que l'API : facture.lire ET (encaissement.gerer OU indicateurs.cabinet).
  if (!aPermission(roles, "facture.lire") || (!gerer && !indicateurs)) redirect("/acces-refuse");
  const filtres = lireFiltresBalance(await searchParams);
  const jour = aujourdhui();
  const nul = Promise.resolve(null);
  const [balance, enRetard, parametres] = await Promise.all([
    chargerServeur<BalanceAgee>(`/api/finance/balance-agee?${requeteBalance(filtres)}`),
    gerer ? chargerServeur<{ elements: Creance[] }>("/api/finance/creances") : nul,
    gerer ? chargerServeur<Parametres>("/api/finance/parametres-relances") : nul,
  ]);

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t("Créances", "Receivables")}
        soustitre={t(
          "Factures émises restant dues, balance âgée par client, délai moyen d'encaissement et relances.",
          "Issued invoices still due, aged balance by client, average collection time and reminders.",
        )}
      />
      {indicateurs ? (
        // Calcul des indicateurs plus long : affiché en différé, sans bloquer la balance âgée.
        <Suspense
          fallback={
            <Squelette
              avecTitre
              lignes={2}
              libelle={t("Calcul du délai moyen…", "Computing the average time…")}
            />
          }
        >
          <DelaiMoyenDiffere jour={jour} langue={langue} />
        </Suspense>
      ) : null}
      <Carte titre={t("Balance âgée", "Aged balance")}>
        <div className="mp-pile">
          <form
            method="get"
            action="/facturation/creances"
            className="mp-filtres"
            aria-label={t("Paramètres de la balance âgée", "Aged balance settings")}
          >
            <div className="mp-grille-champs mp-grille-champs--filtres">
              <Champ
                libelle={t("Date de référence", "Reference date")}
                type="date"
                name="date"
                defaultValue={filtres.date || jour}
              />
              <Select
                libelle={t("Ancienneté comptée depuis", "Age counted from")}
                name="base"
                defaultValue={filtres.base}
                options={[
                  { valeur: "echeance", libelle: t("La date d'échéance", "The due date") },
                  { valeur: "emission", libelle: t("La date d'émission", "The issue date") },
                ]}
              />
            </div>
            <div className="mp-actions-formulaire">
              <button type="submit" className={classesBouton("primaire")}>
                <Icone nom="entonnoir" />
                <span>{t("Afficher", "Show")}</span>
              </button>
            </div>
          </form>
          <p className="mp-aide-lecture">
            {t(
              "Chaque colonne regroupe les montants restant dus selon le retard à la date de référence ; les tranches de plus de 60 jours sont en rouge.",
              "Each column groups the amounts still due by how late they are on the reference date; buckets over 60 days are shown in red.",
            )}
          </p>
          {!balance.ok ? (
            <EtatErreur
              titre={t(
                "La balance âgée n'a pas pu être chargée.",
                "The aged balance could not be loaded.",
              )}
              message={balance.message}
              hrefReessayer={`/facturation/creances?${requeteBalance(filtres)}`}
            />
          ) : balance.donnees.devises.length === 0 ? (
            <EtatVide
              titre={t("Aucune créance à cette date.", "No receivables on this date.")}
              icone="succes"
            >
              <p>
                {t("Toutes les factures émises sont soldées.", "All issued invoices are paid.")}
              </p>
            </EtatVide>
          ) : (
            balance.donnees.devises.map((d) => (
              <div key={d.devise} className="mp-pile mp-chiffres mp-balance">
                <Tableau
                  legende={t(
                    `Balance âgée au ${formaterDate(balance.donnees.date, "UTC", langue)} en ${libelleDevise(d.devise)}, ancienneté depuis la ${BASE_LIBELLES[balance.donnees.base]}`,
                    `Aged balance as of ${formaterDate(balance.donnees.date, "UTC", langue)} in ${libelleDevise(d.devise)}, aged from the ${BASE_LIBELLES_EN[balance.donnees.base]}`,
                  )}
                  legendeVisible
                  lignes={[
                    ...d.clients,
                    {
                      ...d.total,
                      client_id: "total",
                      raison_sociale: t("Total du cabinet", "Firm total"),
                    },
                  ]}
                  cleLigne={(l) => l.client_id}
                  colonnes={colonnesBalance(d.devise, langue)}
                />
              </div>
            ))
          )}
        </div>
      </Carte>
      {enRetard ? <FacturesDues r={enRetard} langue={langue} /> : null}
      {parametres ? (
        parametres.ok ? (
          <ParametresRelances parametres={parametres.donnees} />
        ) : (
          <EtatErreur
            titre={t(
              "Les paramètres de relance n'ont pas pu être chargés.",
              "The reminder settings could not be loaded.",
            )}
            message={parametres.message}
            hrefReessayer="/facturation/creances"
          />
        )
      ) : null}
    </div>
  );
}

async function DelaiMoyenDiffere({ jour, langue }: { jour: string; langue: Langue }) {
  const delai = await chargerServeur<ReponseIndicateurs>(
    `/api/indicateurs/cabinet?${requeteIndicateurs({ du: debutDAnnee(jour), au: jour, niveau: "cabinet" })}`,
  );
  return <DelaiMoyen delai={delai} langue={langue} />;
}

function DelaiMoyen({
  delai,
  langue,
}: {
  delai: Chargement<ReponseIndicateurs> | null;
  langue: Langue;
}) {
  if (!delai?.ok) return null;
  const t: Traduire = creerTraduire(langue);
  const c = delai.donnees.cabinet;
  const statut = statutDelai(c.delai_moyen_encaissement, langue);
  const n = c.factures_soldees;
  return (
    <Carte titre={t("Délai moyen d'encaissement", "Average collection time")}>
      <div className="mp-indicateur-ligne">
        <p className="mp-indicateur__valeur">{formaterDelai(c.delai_moyen_encaissement, langue)}</p>
        <BadgeStatut tonalite={statut.tonalite}>{statut.libelle}</BadgeStatut>
      </div>
      <p className="mp-texte-doux">
        {t(
          `Jours entre émission et encaissement des factures soldées depuis le ${formaterDate(delai.donnees.du, "UTC", langue)} (${n} facture${n > 1 ? "s" : ""}).`,
          `Days between issuance and payment of invoices paid since ${formaterDate(delai.donnees.du, "UTC", langue)} (${n} invoice${n > 1 ? "s" : ""}).`,
        )}
      </p>
    </Carte>
  );
}

function FacturesDues({ r, langue }: { r: Chargement<{ elements: Creance[] }>; langue: Langue }) {
  const t: Traduire = creerTraduire(langue);
  return (
    <Carte titre={t("Factures restant dues", "Invoices still due")}>
      {!r.ok ? (
        <EtatErreur
          titre={t(
            "Les factures restant dues n'ont pas pu être chargées.",
            "The invoices still due could not be loaded.",
          )}
          message={r.message}
          hrefReessayer="/facturation/creances"
        />
      ) : (
        <div className="mp-chiffres mp-tableau-cliquable">
          <Tableau
            legende={t(
              "Factures émises restant dues, par échéance",
              "Issued invoices still due, by due date",
            )}
            lignes={r.donnees.elements}
            cleLigne={(c) => c.facture_id}
            messageVide={t("Aucune facture restant due.", "No invoices still due.")}
            colonnes={[
              {
                cle: "facture",
                entete: t("Facture", "Invoice"),
                rendu: (c) => (
                  <Link
                    href={`/facturation/${c.facture_id}`}
                    className="mp-sans-coupure mp-lien-ligne"
                  >
                    {c.numero ?? t("Facture", "Invoice")}
                  </Link>
                ),
              },
              {
                cle: "client",
                entete: t("Client", "Client"),
                rendu: (c) => c.client_raison_sociale,
              },
              {
                cle: "echeance",
                entete: t("Échéance", "Due date"),
                rendu: (c) => formaterDate(c.date_echeance, "UTC", langue),
              },
              {
                cle: "solde",
                entete: t("Reste à payer", "Balance due"),
                alignement: "droite",
                rendu: (c) => (
                  <span className="mp-montant">
                    {formaterMontantMineur(c.solde, c.devise, langue)}
                  </span>
                ),
              },
              {
                cle: "statut",
                entete: t("Paiement", "Payment"),
                rendu: (c) => (
                  <BadgePaiement statut={c.statut_paiement} joursRetard={c.jours_retard} />
                ),
              },
            ]}
          />
        </div>
      )}
      <p className="mp-texte-doux mp-note-sous-tableau">
        {t(
          "L'historique des relances et la relance manuelle se trouvent sur la fiche de chaque facture.",
          "The reminder history and manual reminders are on each invoice's page.",
        )}
      </p>
    </Carte>
  );
}
