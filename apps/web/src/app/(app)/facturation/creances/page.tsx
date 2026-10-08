import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Squelette } from "../../../../components/ui/Squelette";
import { aPermission } from "@missionpilot/shared";
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
  lireFiltresBalance,
  requeteBalance,
  TRANCHES,
  type BalanceAgee,
  type LigneBalanceClient,
  type ParametresRelances as Parametres,
  type ValeursBalance,
} from "../../../../lib/creances";
import type { Creance } from "../../../../lib/encaissements";
import { formaterDate, formaterMontantMineur, type Devise } from "../../../../lib/format";
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

export const metadata: Metadata = { title: "Créances" };

function colonnesBalance(devise: Devise): ColonneTableau<LigneBalanceClient>[] {
  return [
    { cle: "client", entete: "Client", rendu: (l) => l.raison_sociale ?? "Client" },
    ...TRANCHES.map((t) => ({
      cle: t.cle,
      entete: t.libelle,
      alignement: "droite" as const,
      rendu: (l: ValeursBalance) => (
        <span className="mp-montant">{formaterMontantMineur(l[t.cle], devise)}</span>
      ),
    })),
    {
      cle: "total",
      entete: "Total dû",
      alignement: "droite",
      rendu: (l) => (
        <strong className="mp-montant">{formaterMontantMineur(l.total, devise)}</strong>
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
        titre="Créances"
        soustitre="Factures émises restant dues, balance âgée par client, délai moyen d'encaissement et relances."
      />
      {indicateurs ? (
        // Calcul des indicateurs plus long : affiché en différé, sans bloquer la balance âgée.
        <Suspense fallback={<Squelette avecTitre lignes={2} libelle="Calcul du délai moyen…" />}>
          <DelaiMoyenDiffere jour={jour} />
        </Suspense>
      ) : null}
      <Carte titre="Balance âgée">
        <div className="mp-pile">
          <form
            method="get"
            action="/facturation/creances"
            className="mp-filtres"
            aria-label="Paramètres de la balance âgée"
          >
            <div className="mp-grille-champs mp-grille-champs--filtres">
              <Champ
                libelle="Date de référence"
                type="date"
                name="date"
                defaultValue={filtres.date || jour}
              />
              <Select
                libelle="Ancienneté comptée depuis"
                name="base"
                defaultValue={filtres.base}
                options={[
                  { valeur: "echeance", libelle: "La date d'échéance" },
                  { valeur: "emission", libelle: "La date d'émission" },
                ]}
              />
            </div>
            <div className="mp-actions-formulaire">
              <button type="submit" className={classesBouton("primaire")}>
                <Icone nom="entonnoir" />
                <span>Afficher</span>
              </button>
            </div>
          </form>
          {!balance.ok ? (
            <EtatErreur
              titre="La balance âgée n'a pas pu être chargée."
              message={balance.message}
              hrefReessayer={`/facturation/creances?${requeteBalance(filtres)}`}
            />
          ) : balance.donnees.devises.length === 0 ? (
            <EtatVide titre="Aucune créance à cette date." icone="succes">
              <p>Toutes les factures émises sont soldées.</p>
            </EtatVide>
          ) : (
            balance.donnees.devises.map((d) => (
              <div key={d.devise} className="mp-pile">
                <Tableau
                  legende={`Balance âgée au ${formaterDate(balance.donnees.date)} en ${d.devise}, ancienneté depuis la ${BASE_LIBELLES[balance.donnees.base]}`}
                  legendeVisible
                  lignes={[
                    ...d.clients,
                    { ...d.total, client_id: "total", raison_sociale: "Total du cabinet" },
                  ]}
                  cleLigne={(l) => l.client_id}
                  colonnes={colonnesBalance(d.devise)}
                />
              </div>
            ))
          )}
        </div>
      </Carte>
      {enRetard ? <FacturesDues r={enRetard} /> : null}
      {parametres ? (
        parametres.ok ? (
          <ParametresRelances parametres={parametres.donnees} />
        ) : (
          <EtatErreur
            titre="Les paramètres de relance n'ont pas pu être chargés."
            message={parametres.message}
            hrefReessayer="/facturation/creances"
          />
        )
      ) : null}
    </div>
  );
}

async function DelaiMoyenDiffere({ jour }: { jour: string }) {
  const delai = await chargerServeur<ReponseIndicateurs>(
    `/api/indicateurs/cabinet?${requeteIndicateurs({ du: debutDAnnee(jour), au: jour, niveau: "cabinet" })}`,
  );
  return <DelaiMoyen delai={delai} />;
}

function DelaiMoyen({ delai }: { delai: Chargement<ReponseIndicateurs> | null }) {
  if (!delai?.ok) return null;
  const c = delai.donnees.cabinet;
  const statut = statutDelai(c.delai_moyen_encaissement);
  return (
    <Carte titre="Délai moyen d'encaissement">
      <div className="mp-indicateur-ligne">
        <p className="mp-indicateur__valeur">{formaterDelai(c.delai_moyen_encaissement)}</p>
        <BadgeStatut tonalite={statut.tonalite}>{statut.libelle}</BadgeStatut>
      </div>
      <p className="mp-texte-doux">
        {`Jours entre émission et encaissement des factures soldées depuis le ${formaterDate(delai.donnees.du)} (${c.factures_soldees} facture${c.factures_soldees > 1 ? "s" : ""}).`}
      </p>
    </Carte>
  );
}

function FacturesDues({ r }: { r: Chargement<{ elements: Creance[] }> }) {
  return (
    <Carte titre="Factures restant dues">
      {!r.ok ? (
        <EtatErreur
          titre="Les factures restant dues n'ont pas pu être chargées."
          message={r.message}
          hrefReessayer="/facturation/creances"
        />
      ) : (
        <Tableau
          legende="Factures émises restant dues, par échéance"
          lignes={r.donnees.elements}
          cleLigne={(c) => c.facture_id}
          messageVide="Aucune facture restant due."
          colonnes={[
            {
              cle: "facture",
              entete: "Facture",
              rendu: (c) => (
                <Link href={`/facturation/${c.facture_id}`} className="mp-sans-coupure">
                  {c.numero ?? "Facture"}
                </Link>
              ),
            },
            { cle: "client", entete: "Client", rendu: (c) => c.client_raison_sociale },
            { cle: "echeance", entete: "Échéance", rendu: (c) => formaterDate(c.date_echeance) },
            {
              cle: "solde",
              entete: "Reste à payer",
              alignement: "droite",
              rendu: (c) => (
                <span className="mp-montant">{formaterMontantMineur(c.solde, c.devise)}</span>
              ),
            },
            {
              cle: "statut",
              entete: "Paiement",
              rendu: (c) => (
                <BadgePaiement statut={c.statut_paiement} joursRetard={c.jours_retard} />
              ),
            },
          ]}
        />
      )}
      <p className="mp-texte-doux">
        L&apos;historique des relances et la relance manuelle se trouvent sur la fiche de chaque
        facture.
      </p>
    </Carte>
  );
}
