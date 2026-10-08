import Link from "next/link";
import type { Metadata } from "next";
import {
  CLASSE_RISQUE_LIBELLES,
  CLASSES_RISQUE,
  STATUTS_ASSERTION as STATUTS,
} from "@missionpilot/shared";
import { BadgeSolidite } from "../../../../../../components/preuves/BadgeSolidite";
import { Alerte } from "../../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../../components/ui/BadgeStatut";
import { classesBouton } from "../../../../../../components/ui/Bouton";
import { Carte } from "../../../../../../components/ui/Carte";
import { Champ } from "../../../../../../components/ui/Champ";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../../../../components/ui/EtatListe";
import { Icone } from "../../../../../../components/ui/Icone";
import { Select } from "../../../../../../components/ui/Select";
import { chargerServeur } from "../../../../../../lib/api-serveur";
import { chargerMission } from "../../../../../../lib/missions-serveur";
import {
  ANOMALIE_LIBELLES,
  cheminControle,
  droitsPreuves,
  hrefAssertion,
  hrefAssertions,
  hrefAssertionsFiltre,
  hrefNouvelleAssertion,
  lireParametresAssertions,
  requeteAssertions,
  STATUTS_ASSERTION,
  type ControleLivrableVue,
  type ElementAssertion,
  type PageApi,
} from "../../../../../../lib/preuves";
import { exigerPermission } from "../../../../../../lib/session";

export const metadata: Metadata = { title: "Assertions" };

/**
 * Assertions de la mission (PRV-02, PRV-03) : conclusions à écrire dans un livrable, avec leur
 * indice de solidité calculé par le moteur, et contrôle des livrables de classe R2 et R3 (preuve
 * ou avis d'expert signé).
 */
export default async function PageAssertions({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const { utilisateur } = await exigerPermission("preuve.lire");
  const r = await chargerMission(id);
  if (!r.ok) return null;
  const droits = droitsPreuves(utilisateur.roles, r.donnees);
  const p = lireParametresAssertions(await searchParams);
  const [page, controle] = await Promise.all([
    chargerServeur<PageApi<ElementAssertion>>(
      `/api/missions/${id}/assertions?${requeteAssertions(p)}`,
    ),
    chargerServeur<ControleLivrableVue>(cheminControle(id)),
  ]);
  const filtre = Boolean(p.q ?? p.statut ?? p.classe_risque);

  return (
    <>
      {controle.ok ? (
        controle.donnees.conforme ? (
          <Alerte tonalite="succes" titre="Contrôle des livrables R2 et R3" annonce="aucune">
            <p>
              {controle.donnees.controlees === 0
                ? "Aucune assertion de classe R2 ou R3 à contrôler pour le moment."
                : `Les ${controle.donnees.controlees} assertion(s) R2 et R3 reposent sur une preuve ou sur un avis d'expert signé.`}
            </p>
          </Alerte>
        ) : (
          <Alerte tonalite="attention" titre="Contrôle des livrables R2 et R3" annonce="aucune">
            <p>
              {controle.donnees.anomalies.length} assertion(s) R2 ou R3 ne reposent ni sur une
              preuve ni sur un avis d&apos;expert signé : elles ne peuvent pas partir dans un
              livrable.
            </p>
            <ul className="mp-liste-simple">
              {controle.donnees.anomalies.map((a) => (
                <li key={a.assertion_id}>
                  <Link href={hrefAssertion(id, a.assertion_id)}>{a.enonce}</Link>
                  {` · ${a.classe_risque} · ${ANOMALIE_LIBELLES[a.code]}`}
                </li>
              ))}
            </ul>
          </Alerte>
        )
      ) : (
        <Alerte tonalite="attention" titre="Contrôle des livrables indisponible" annonce="aucune">
          <p>{controle.message}</p>
        </Alerte>
      )}

      {droits.ecrire ? (
        <div>
          <Link href={hrefNouvelleAssertion(id)} className={classesBouton("primaire")}>
            <Icone nom="plus" />
            <span>Nouvelle assertion</span>
          </Link>
        </div>
      ) : null}

      <form
        method="get"
        action={hrefAssertions(id)}
        className="mp-filtres"
        role="search"
        aria-label="Filtrer les assertions"
      >
        <div className="mp-grille-champs mp-grille-champs--filtres">
          <Champ
            libelle="Rechercher"
            type="search"
            name="q"
            maxLength={100}
            defaultValue={p.q}
            autoComplete="off"
          />
          <Select
            libelle="Statut"
            name="statut"
            invite="Tous"
            options={STATUTS.map((s) => ({ valeur: s, libelle: STATUTS_ASSERTION[s] }))}
            defaultValue={p.statut}
          />
          <Select
            libelle="Classe de risque"
            name="classe_risque"
            invite="Toutes"
            options={CLASSES_RISQUE.map((c) => ({
              valeur: c,
              libelle: `${c} · ${CLASSE_RISQUE_LIBELLES[c]}`,
            }))}
            defaultValue={p.classe_risque}
          />
        </div>
        <div className="mp-actions-formulaire">
          <button type="submit" className={classesBouton("secondaire")}>
            <Icone nom="recherche" />
            <span>Filtrer</span>
          </button>
        </div>
      </form>

      {!page.ok ? (
        <EtatErreur
          titre="Les assertions n'ont pas pu être chargées."
          message={page.message}
          hrefReessayer={hrefAssertionsFiltre(id, p, p.curseur ?? null)}
        />
      ) : page.donnees.elements.length === 0 ? (
        <EtatVide
          titre={filtre ? "Aucune assertion ne correspond." : "Aucune assertion enregistrée."}
          icone="bulle"
        >
          <p>
            {filtre
              ? "Élargissez les filtres pour revoir toutes les assertions."
              : droits.ecrire
                ? "Formulez les conclusions que vous voulez écrire dans un livrable, puis reliez-les à leurs preuves."
                : "Les assertions de la mission apparaîtront ici dès qu'un consultant les aura formulées."}
          </p>
        </EtatVide>
      ) : (
        <>
          <ul className="mp-preuves-liste" aria-label="Assertions de la mission">
            {page.donnees.elements.map((a) => (
              <li key={a.id} className="mp-preuve-ligne">
                <h3 className="mp-preuve-ligne__titre">
                  <Link href={hrefAssertion(id, a.id)}>{a.enonce}</Link>
                </h3>
                <span className="mp-preuve-ligne__meta">
                  <BadgeSolidite solidite={a.solidite} />
                  <BadgeStatut tonalite="neutre" sansIcone>
                    {`${a.classe_risque} · ${CLASSE_RISQUE_LIBELLES[a.classe_risque]}`}
                  </BadgeStatut>
                  <BadgeStatut tonalite="neutre" sansIcone>
                    {STATUTS_ASSERTION[a.statut]}
                  </BadgeStatut>
                  {a.avis_expert ? (
                    <BadgeStatut tonalite={a.avis_expert.signe ? "succes" : "attention"}>
                      {a.avis_expert.signe ? "Avis d'expert signé" : "Avis d'expert non signé"}
                    </BadgeStatut>
                  ) : null}
                  {a.a_arbitrer > 0 ? (
                    <BadgeStatut tonalite="danger">{`${a.a_arbitrer} contradiction(s) à arbitrer`}</BadgeStatut>
                  ) : null}
                </span>
                {a.livrable ? (
                  <p className="mp-texte-doux mp-texte-petit">Livrable : {a.livrable}</p>
                ) : null}
              </li>
            ))}
          </ul>
          <PaginationCurseur
            libelle="Pagination des assertions"
            hrefSuivante={
              page.donnees.curseur_suivant
                ? hrefAssertionsFiltre(id, p, page.donnees.curseur_suivant)
                : null
            }
            hrefDebut={p.curseur ? hrefAssertionsFiltre(id, p, null) : null}
          />
        </>
      )}
      <Carte titre="Comment lire l'indice">
        <p className="mp-texte-doux">
          Pour chaque type de source indépendant (questionnaire, entretien, observation, document,
          donnée externe), la meilleure fiabilité est retenue ; la somme est plafonnée puis ramenée
          entre 0 et 1. Une contradiction non arbitrée divise l&apos;indice par deux. Ces valeurs
          sont calculées par le moteur de MissionPilot et à calibrer au pilote.
        </p>
      </Carte>
    </>
  );
}
